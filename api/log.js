// API endpoint для приема логов
export default function handler(req, res) {
  // CORS для разрешения запросов с любого домена
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    try {
      const { message, timestamp, url, userAgent, level } = req.body;
      
      // Выводим лог в консоль Vercel (будет видно в терминале)
      console.log(`[${timestamp}] [${level}] ${message}`);
      if (url) console.log(`📍 URL: ${url}`);
      if (userAgent) console.log(`🌐 User Agent: ${userAgent}`);
      console.log('─'.repeat(80));
      
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('Ошибка обработки лога:', error);
      res.status(400).json({ error: 'Invalid request' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
