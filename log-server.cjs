// Простой HTTP сервер для приёма логов из браузера
const http = require('http');

const PORT = 3030;

const server = http.createServer((req, res) => {
  // CORS для разрешения запросов с localhost:5173
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const { message, data, timestamp } = JSON.parse(body);
        
        // Форматируем вывод с цветами (ANSI escape codes)
        const timeColor = '\x1b[90m'; // Серый
        const messageColor = '\x1b[36m'; // Cyan
        const dataColor = '\x1b[33m'; // Желтый
        const reset = '\x1b[0m';
        
        console.log(`${timeColor}[${timestamp}]${reset} ${messageColor}${message}${reset}`);
        
        if (data !== undefined && data !== null) {
          if (typeof data === 'object') {
            console.log(`${dataColor}${JSON.stringify(data, null, 2)}${reset}`);
          } else {
            console.log(`${dataColor}${data}${reset}`);
          }
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        console.error('Ошибка парсинга лога:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log('\x1b[32m%s\x1b[0m', `
╔═══════════════════════════════════════════╗
║   🚀 Сервер логов запущен на :${PORT}     ║
║   Логи из браузера появятся здесь ↓      ║
╚═══════════════════════════════════════════╝
`);
});

// Обработка Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\x1b[31m%s\x1b[0m', '✖ Сервер логов остановлен');
  process.exit(0);
});

