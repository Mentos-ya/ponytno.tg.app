// Простой HTTP сервер для приёма логов из браузера
const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = 3030;

const clients = new Set()
const STATIC_DIR = path.join(__dirname, 'dist')

// Загружаем переменные окружения
require('dotenv').config({ path: '.env.local' })

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'application/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.ico': return 'image/x-icon'
    default: return 'application/octet-stream'
  }
}

// Вспомогательная функция для вызова YandexGPT API
function callYandexGPT(apiKey, folderId, prompt, maxTokens = 100) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      modelUri: `gpt://${folderId}/yandexgpt/latest`,
      completionOptions: {
        stream: false,
        temperature: 0.1,
        maxTokens: maxTokens
      },
      messages: [
        {
          role: 'user',
          text: prompt
        }
      ]
    })

    const options = {
      hostname: 'llm.api.cloud.yandex.net',
      path: '/foundationModels/v1/completion',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${apiKey}`,
        'x-folder-id': folderId,
        'Content-Length': Buffer.byteLength(postData)
      }
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(new Error('Failed to parse YandexGPT API response: ' + e.message))
          }
        } else {
          reject(new Error(`YandexGPT API returned status ${res.statusCode}: ${data}`))
        }
      })
    })

    req.on('error', (e) => {
      reject(e)
    })

    req.write(postData)
    req.end()
  })
}

// Функция для двухэтапного процесса: Vision OCR + GPT классификация (ПРИОРИТЕТ 1)
async function analyzeWithYandexGPT(imageData, mimeType = 'image/jpeg') {
  const visionApiKey = process.env.YANDEX_VISION_API_KEY?.trim()
  const gptApiKey = process.env.YANDEX_GPT_API_KEY?.trim()
  const folderId = process.env.YANDEX_FOLDER_ID?.trim()

  if (!visionApiKey || !gptApiKey || !folderId) {
    throw new Error('Yandex API configuration missing (need both Vision and GPT keys)')
  }

  console.log('🔍 Этап 1: Yandex Vision OCR')
  
  // Этап 1: Vision API для OCR
  const visionResult = await analyzeWithYandexVision(imageData, mimeType)
  
  // Проверяем правильную структуру ответа Vision API
  if (!visionResult || !visionResult.results || !visionResult.results[0]) {
    throw new Error('Vision API не вернул результатов')
  }
  
  const textDetection = visionResult.results[0].results?.[0]?.textDetection
  if (!textDetection || !textDetection.pages || textDetection.pages.length === 0) {
    throw new Error('Vision API не нашёл текст в изображении')
  }
  
  console.log('📝 Vision успешно распознал текст')
  console.log('🤖 Этап 2: Умный AI-анализ структуры меню через YandexGPT')
  
  // Этап 2: Собираем все слова с координатами
  const page = textDetection.pages[0]
  const allWords = []
  
  if (page.blocks) {
    page.blocks.forEach(block => {
      if (block.lines) {
        block.lines.forEach(line => {
          if (line.words) {
            line.words.forEach(word => {
              const bbox = word.boundingBox ? {
                x0: parseInt(word.boundingBox.vertices[0].x),
                y0: parseInt(word.boundingBox.vertices[0].y),
                x1: parseInt(word.boundingBox.vertices[2].x),
                y1: parseInt(word.boundingBox.vertices[2].y)
              } : null
              
              if (bbox) {
                allWords.push({
                  text: word.text,
                  bbox: bbox,
                  fontSize: bbox.y1 - bbox.y0, // Высота = размер шрифта
                  confidence: word.confidence || 0
                })
              }
            })
          }
        })
      }
    })
  }
  
  if (allWords.length === 0) {
    throw new Error('Vision API не нашёл слов с координатами')
  }
  
  // Группируем слова по строкам (по Y-координате)
  const lines = []
  const tolerance = 10 // Допуск для группировки в одну строку
  
  allWords.forEach(word => {
    const midY = (word.bbox.y0 + word.bbox.y1) / 2
    let foundLine = false
    
    for (let line of lines) {
      const lineMidY = (line.minY + line.maxY) / 2
      if (Math.abs(midY - lineMidY) < tolerance) {
        line.words.push(word)
        line.minY = Math.min(line.minY, word.bbox.y0)
        line.maxY = Math.max(line.maxY, word.bbox.y1)
        foundLine = true
        break
      }
    }
    
    if (!foundLine) {
      lines.push({
        words: [word],
        minY: word.bbox.y0,
        maxY: word.bbox.y1
      })
    }
  })
  
  // Сортируем строки по Y-координате
  lines.sort((a, b) => a.minY - b.minY)
  
  // Сортируем слова в каждой строке по X-координате
  lines.forEach(line => {
    line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0)
    line.text = line.words.map(w => w.text).join(' ')
    line.avgFontSize = line.words.reduce((sum, w) => sum + w.fontSize, 0) / line.words.length
  })
  
  console.log(`📊 Сгруппировано в ${lines.length} строк`)
  
  // Формируем контекст для GPT
  const menuContext = lines.map((line, i) => {
    return `Строка ${i + 1} (Y:${Math.round(line.minY)}, размер:${Math.round(line.avgFontSize)}px): ${line.text}`
  }).join('\n')
  
  const prompt = `Ты эксперт по анализу меню ресторанов. Проанализируй структуру страницы меню и классифицируй каждую строку.

СТРАНИЦА МЕНЮ (${lines.length} строк):
${menuContext}

СТРУКТУРА МЕНЮ - ОБЯЗАТЕЛЬНО:
В любом меню ресторана ВСЕГДА есть названия блюд (title). Это ГЛАВНАЯ сущность, ищи их в первую очередь!

Типичная структура блока меню:
1. TITLE (название блюда) - МОЖЕТ БЫТЬ НА НЕСКОЛЬКИХ СТРОКАХ! Крупный текст, заглавные буквы
2. DESCRIPTION (описание) - ВСЕ строки с ингредиентами/составом (маленький текст, строчные буквы)
3. PRICE (цена) - чистое число на отдельной строке

ЗАДАЧА: Определи для КАЖДОЙ строки ОДНУ категорию:

КАТЕГОРИИ (выбери СТРОГО ОДНУ):
- price_modifier: уточнение размера/варианта блюда (DOUBLE, TRIPLE, SMALL, LARGE - крупный текст, заглавные, НАД основным title)
- title: название блюда (КРУПНЫЙ ТЕКСТ, ЗАГЛАВНЫЕ БУКВЫ, может быть на 2-3 строках подряд, минимум 3+ букв)
- price: ТОЛЬКО если вся строка это ЧИСТОЕ ЧИСЛО (600, 930, 1190)
- description: описание, ингредиенты (маленький текст, строчные буквы, после всех строк title)

🔵 НОВАЯ КАТЕГОРИЯ - price_modifier:
✅ Варианты размера: DOUBLE, TRIPLE, SMALL, MEDIUM, LARGE
✅ Обычно идут ВЫШЕ основного названия блюда
✅ Каждый вариант соответствует своей цене
✅ Крупный текст, заглавные буквы, НО это НЕ название блюда!

Пример структуры:
Строка 1: DOUBLE TRIPLE → price_modifier (варианты размера)
Строка 2: CHEESEBURGER → title (само блюдо)
Строка 3: | 930 | 1190 → символы и цены для каждого варианта

⚠️ ВАЖНО - ЧТО НЕ ЯВЛЯЕТСЯ TITLE:
❌ Отдельные символы: "|", "/", "-", "•" → НЕ title (это description!)
❌ Короткие слова < 2 букв: "|", "I", "L" → НЕ title (это description!)
❌ ТОЛЬКО цифры: "930", "1190" → это price, НЕ title!
❌ Варианты размера: DOUBLE, TRIPLE → это price_modifier, НЕ title!

КРИТИЧЕСКИ ВАЖНО - МНОГОСТРОЧНЫЕ ЗАГОЛОВКИ:
🔥 Название блюда МОЖЕТ быть разбито на НЕСКОЛЬКО СТРОК!

🎯 ПРАВИЛО ОБЪЕДИНЕНИЯ ЗАГОЛОВКОВ:
Если несколько строк подряд имеют признаки title (крупный текст, заглавные буквы) 
И между ними НЕТ description/price → это ОДНО название блюда!

ВСЕ эти строки должны быть помечены как title:
- SCRAMBLED EGGS (строка 1) → title
- ON BRIOCHE (строка 2) → title (продолжение!)
- eggs, cheese... (строка 3) → description (начало описания)

Полное название: "SCRAMBLED EGGS ON BRIOCHE"

❌ НЕПРАВИЛЬНО:
- SCRAMBLED EGGS → title
- ON BRIOCHE → description (ОШИБКА!)

✅ ПРАВИЛЬНО:
- SCRAMBLED EGGS → title
- ON BRIOCHE → title (продолжение названия!)

🔑 КАК ОПРЕДЕЛИТЬ, ЧТО ЭТО ПРОДОЛЖЕНИЕ TITLE:
1. Следующая строка КРУПНАЯ (size ≈ как предыдущая, > 18px)
2. Следующая строка в ЗАГЛАВНЫХ буквах
3. Следующая строка БЕЗ запятых
4. НЕТ description между ними

Примеры многострочных title:
Блок 1:
- Строка 1: SCRAMBLED EGGS → title (часть 1)
- Строка 2: ON BRIOCHE → title (часть 2 - продолжение!)
- Строка 3: 600 → price
Полное название: "SCRAMBLED EGGS ON BRIOCHE"

Блок 2:
- Строка 5: BRIOCHE WITH → title (часть 1)
- Строка 6: GUACAMOLE AND SALMON → title (часть 2 - продолжение!)
- Строка 7: 950 → price
Полное название: "BRIOCHE WITH GUACAMOLE AND SALMON"

Признаки title (даже на 2-3 строках):
✅ КРУПНЫЙ размер шрифта (size > 18px)
✅ ЗАГЛАВНЫЕ БУКВЫ
✅ НЕТ запятых
✅ Несколько таких строк ПОДРЯД = одно название
✅ ДО первого маленького текста (description)

Признаки description:
✅ МАЛЕНЬКИЙ размер шрифта (size < 20px)
✅ строчные буквы (lowercase)
✅ запятые между словами (eggs, cheese, tomatoes)
✅ НАЧИНАЕТСЯ ТОЛЬКО ПОСЛЕ всех строк title

ПРАВИЛА КЛАССИФИКАЦИИ:
1. ЗАГОЛОВКИ (title) - смотри на размер и регистр!
   - Если строка КРУПНАЯ (size > 20px) И ЗАГЛАВНЫЕ БУКВЫ → это title
   - title может продолжаться 2-3 строки подряд (все крупные, все заглавные)
   - Смотри не только на текст, но на SIZE и Y-координату!
   
2. ОПИСАНИЯ (description) - маленький текст после ВСЕХ title!
   - НАЧИНАЕТСЯ только после того как закончились ВСЕ строки title
   - Маленький размер шрифта
   - Строчные буквы, запятые
   
3. ЦЕНЫ (price):
   - Только ЧИСТОЕ ЧИСЛО на отдельной строке
   - 600, 930, 1190 (без букв, без символов, кроме цифр)

🔥 СПЕЦИАЛЬНОЕ ПРАВИЛО - ЦЕНА ВНУТРИ НАЗВАНИЯ:
Если цена находится В СТРОКЕ с заглавными буквами (title),
И ПОСЛЕ цены на той же или следующей строке снова идут заглавные буквы:
→ ВСЕ заглавные слова (до и после цены) = title
→ ТОЛЬКО число = price

Пример:
Строка 11 (size: 20px): ZUCCHINI PANCAKES WITH | 980
Строка 12 (size: 18px): SALMON AND EGGS

Анализ:
- ZUCCHINI → title (крупный, заглавные)
- PANCAKES → title (крупный, заглавные)
- WITH → title (крупный, заглавные)
- 980 → price (число)
- SALMON → title (крупный, заглавные - ПРОДОЛЖЕНИЕ названия после цены!)
- AND → title (крупный, заглавные - ПРОДОЛЖЕНИЕ!)
- EGGS → title (крупный, заглавные - ПРОДОЛЖЕНИЕ!)

Полное название: "ZUCCHINI PANCAKES WITH SALMON AND EGGS"
Цена: 980

❗ВАЖНО: Если ПОСЛЕ price снова идут крупные заглавные буквы - это НЕ новое блюдо, 
а ПРОДОЛЖЕНИЕ названия! Новое блюдо начинается только с description или price_modifier.

🎯 ЗОЛОТОЕ ПРАВИЛО - СТРУКТУРА БЛОКА МЕНЮ:
Каждый блок меню ОБЯЗАТЕЛЬНО состоит из:
1. price_modifier (опционально) - варианты размера
2. title (обязательно) - название блюда (1-3 строки подряд)
3. price (обязательно) - цена
4. description (обязательно) - описание ингредиентов

❗ КЛЮЧЕВОЕ ПРАВИЛО: Title заканчивается ТОЛЬКО когда встречается description!

Если после title НЕТ description → это еще НЕ конец названия!
Продолжай объединять все title подряд до первого description.

Пример правильного блока:
✅ ZUCCHINI PANCAKES WITH → title (строка 1)
✅ 980 → price (может быть внутри)
✅ SALMON AND EGGS → title (строка 2 - продолжение, т.к. НЕТ description!)
✅ zucchini, salmon, eggs... → description (ВОТ где заканчивается title!)

Полное название: "ZUCCHINI PANCAKES WITH SALMON AND EGGS"

Пример НЕПРАВИЛЬНОГО разбиения:
❌ ZUCCHINI PANCAKES WITH → title блока 1
❌ 980 → price блока 1
❌ (НЕТ description!) → ОШИБКА! Блок не завершён!
❌ SALMON AND EGGS → title блока 2 (ОШИБКА!)

ЗАПОМНИ: Несколько строк title ПОДРЯД (даже через price) = ОДНО название,
пока не встретится description!

ПРИМЕР АНАЛИЗА:
Строка 1 (Y:25, размер:22px): DOUBLE TRIPLE
→ category: "price_modifier" (крупный, заглавные, варианты размера - НАД основным названием!)

Строка 2 (Y:66, размер:20px): CHEESEBURGER
→ category: "title" (крупный, заглавные - ОСНОВНОЕ название блюда!)

Строка 3 (Y:88, размер:20px): | 930 | 1190
→ category: "description" (символы "|" и цифры 930, 1190 - будут исправлены фильтром)

Строка 4 (Y:111, размер:14px): eggs, arugula, brioche, cream
→ category: "description" (маленький, строчные, запятые - описание!)

❗ ПОМНИ: 
- DOUBLE, TRIPLE перед названием → price_modifier (НЕ title!)
- Символы "|", "/", "-" НИКОГДА не title!
- Основное название блюда (CHEESEBURGER) → title!

ВЕРНИ ТОЛЬКО JSON массив (без пояснений, без запятых в category):
[{"line": 1, "category": "title"}, {"line": 2, "category": "description"}, ...]`

  console.log('🤖 Отправляем структуру меню в YandexGPT для анализа...')
  
  let classifiedWords = []
  
  try {
    const gptResult = await callYandexGPT(gptApiKey, folderId, prompt, 1000)
    
    // Логируем информацию об использовании токенов
    if (gptResult.result?.usage) {
      const usage = gptResult.result.usage
      console.log('💰 Использование токенов YandexGPT:')
      console.log(`   Input tokens: ${usage.inputTextTokens || 0}`)
      console.log(`   Output tokens: ${usage.completionTokens || 0}`)
      console.log(`   Total tokens: ${usage.totalTokens || 0}`)
      
      // Примерный расчёт стоимости для YandexGPT Lite (0.15₽ за 1000 токенов)
      const estimatedCost = ((usage.totalTokens || 0) / 1000) * 0.15
      console.log(`   📊 Примерная стоимость GPT: ~${estimatedCost.toFixed(4)}₽`)
    }
    
    const gptText = gptResult.result?.alternatives?.[0]?.message?.text?.trim()
    
    if (!gptText) {
      throw new Error('YandexGPT не вернул ответ')
    }
    
    console.log('📦 Ответ GPT получен, парсим классификацию...')
    
    // Парсим JSON из ответа (может быть в ```json ... ```)
    let classification
    const jsonMatch = gptText.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      classification = JSON.parse(jsonMatch[0])
    } else {
      classification = JSON.parse(gptText)
    }
    
    console.log(`✅ GPT проанализировал ${classification.length} строк`)
    
    // Применяем классификацию к словам
    lines.forEach((line, lineIndex) => {
      const lineClassification = classification.find(c => c.line === lineIndex + 1)
      let category = lineClassification?.category || 'description'
      
      // Защита от запятых: если GPT вернул "title, price" → берём первое
      if (typeof category === 'string' && category.includes(',')) {
        category = category.split(',')[0].trim()
        console.log(`⚠️ Исправлена категория со строки ${lineIndex + 1}: "${lineClassification.category}" → "${category}"`)
      }
      
      // Дополнительная умная логика для смешанных строк
      line.words.forEach(word => {
        let wordCategory = category
        const text = word.text.trim()
        const isNumber = /^\d+$/.test(text)
        
        // УНИВЕРСАЛЬНЫЙ ФИЛЬТР: Чистые числа ВСЕГДА price (независимо от категории GPT)
        if (isNumber) {
          wordCategory = 'price'
          if (category !== 'price') {
            console.log(`🔧 Исправлена категория числа "${text}": ${category} → price`)
          }
        }
        // ФИЛЬТР для title: не может быть символом или коротким словом
        else if (category === 'title') {
          const letterCount = (text.match(/[a-zA-Zа-яА-ЯёЁ]/g) || []).length
          
          // Если меньше 2 букв или только символы → это description (не title!)
          if (letterCount < 2 || /^[|\/\-•.,;:!?]+$/.test(text)) {
            wordCategory = 'description'
            console.log(`🔧 Исправлена категория символа "${text}": title → description`)
          }
        }
        
        classifiedWords.push({
          text: word.text,
          category: wordCategory,
          bbox: word.bbox
        })
      })
    })
    
    console.log(`✅ Применена AI-классификация к ${classifiedWords.length} словам`)
    
  } catch (gptError) {
    console.warn('⚠️ GPT-анализ не удался, используем эвристику:', gptError.message)
    
    // Fallback на эвристику
    allWords.forEach(word => {
      let category = 'description'
      if (/^\d+$/.test(word.text)) {
        category = 'price'
      } else if (word.text.length > 2 && word.text === word.text.toUpperCase()) {
        category = 'title'
      }
      
      classifiedWords.push({
        text: word.text,
        category: category,
        bbox: word.bbox
      })
    })
    
    console.log(`✅ Fallback: классифицировано ${classifiedWords.length} слов (эвристика)`)
  }
  
  return {
    words: classifiedWords,
    totalText: allWords.map(w => w.text).join(' '),
    totalWords: classifiedWords.length,
    source: 'yandex-vision-gpt'
  }
}

// Функция для Yandex Vision API (ПРИОРИТЕТ 2 - fallback)
async function analyzeWithYandexVision(imageData, mimeType = 'image/jpeg') {
  const apiKey = process.env.YANDEX_VISION_API_KEY?.trim()
  const folderId = process.env.YANDEX_FOLDER_ID?.trim()

  if (!apiKey || !folderId) {
    throw new Error('Yandex Vision API configuration missing')
  }

  // Убираем data:image/jpeg;base64, если есть
  const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData
  
  // Логируем размер изображения
  console.log(`📊 Размер base64 данных: ${base64Data.length} символов`)
  console.log(`📊 Примерный размер изображения: ${Math.round(base64Data.length * 0.75 / 1024)} KB`)

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      folderId: folderId,
      analyze_specs: [
        {
          content: base64Data,
          features: [
            {
              type: 'TEXT_DETECTION',
              text_detection_config: {
                language_codes: ['ru', 'en']
              }
            }
          ]
        }
      ]
    })

    const options = {
      hostname: 'vision.api.cloud.yandex.net',
      port: 443,
      path: '/vision/v1/batchAnalyze',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => data += chunk)
      res.on('end', () => {
        try {
          const result = JSON.parse(data)
          if (res.statusCode === 200) {
            resolve(result)
          } else {
            reject(new Error(`Vision API error: ${res.statusCode} - ${data}`))
          }
        } catch (error) {
          reject(new Error(`Failed to parse Vision API response: ${error.message}`))
        }
      })
    })

    req.on('error', (error) => {
      reject(new Error(`Vision API request failed: ${error.message}`))
    })

    req.write(postData)
    req.end()
  })
}

function serveStatic(req, res) {
  const urlPath = decodeURI(req.url.split('?')[0])
  let filePath = path.join(STATIC_DIR, urlPath)
  // Защита от выхода из директории
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403)
    res.end('Forbidden')
    return true
  }
  // Если это директория или корень — отдаём index.html (SPA)
  if (urlPath === '/' || fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(STATIC_DIR, 'index.html')
  }
  if (fs.existsSync(filePath)) {
    res.writeHead(200, { 'Content-Type': getContentType(filePath) })
    if (req.method === 'HEAD') {
      res.end()
    } else {
      fs.createReadStream(filePath).pipe(res)
    }
    return true
  }
  // Попробуем assets/ из Vite
  const assetsPath = path.join(STATIC_DIR, 'assets', path.basename(urlPath))
  if (fs.existsSync(assetsPath)) {
    res.writeHead(200, { 'Content-Type': getContentType(assetsPath) })
    if (req.method === 'HEAD') {
      res.end()
    } else {
      fs.createReadStream(assetsPath).pipe(res)
    }
    return true
  }
  return false
}

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

  // Простые GET endpoints для проверки живости
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('OK')
    return
  }

  // Отдача статики и SPA fallback (до обработки API)
  if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res)) {
    return
  }

  // SSE поток логов
  if (req.method === 'GET' && req.url === '/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    res.write(': connected\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }

  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        let message, data, timestamp
        try {
          ({ message, data, timestamp } = JSON.parse(body))
        } catch (jsonErr) {
          // Фолбэк: принимаем простые форматы body (например, "message:..." или "message=...")
          const m1 = body.match(/message\s*[:=]\s*(.*)/i)
          message = m1 ? m1[1].trim() : String(body).trim()
          data = undefined
          timestamp = new Date().toISOString()
        }
        
        // Форматируем вывод с цветами (ANSI escape codes)
        const timeColor = '\x1b[90m'; // Серый
        const messageColor = '\x1b[36m'; // Cyan
        const dataColor = '\x1b[33m'; // Желтый
        const reset = '\x1b[0m';
        
        const line = `${timeColor}[${timestamp}]${reset} ${messageColor}${message}${reset}`
        console.log(line);
        
        if (data !== undefined && data !== null) {
          if (typeof data === 'object') {
            console.log(`${dataColor}${JSON.stringify(data, null, 2)}${reset}`);
            // Отправляем в SSE подписчикам
            for (const client of clients) {
              client.write(`event: log\n`)
              client.write(`data: ${JSON.stringify({ timestamp, message, data })}\n\n`)
            }
          } else {
            console.log(`${dataColor}${data}${reset}`);
            for (const client of clients) {
              client.write(`event: log\n`)
              client.write(`data: ${JSON.stringify({ timestamp, message, data })}\n\n`)
            }
          }
        }
        if (data === undefined || data === null) {
          for (const client of clients) {
            client.write(`event: log\n`)
            client.write(`data: ${JSON.stringify({ timestamp, message })}\n\n`)
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
  } else if (req.method === 'POST' && req.url === '/api/analyze-image-gpt') {
    // НОВЫЙ ENDPOINT: YandexGPT с мультимодальностью (ПРИОРИТЕТ 1)
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const { imageData, mimeType = 'image/jpeg' } = JSON.parse(body);
        
        if (!imageData) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Image data is required' }));
          return;
        }

        console.log('🤖 Анализируем изображение через YandexGPT API...');
        
        const gptData = await analyzeWithYandexGPT(imageData, mimeType);
        
        // Результат уже готов от новой функции analyzeWithYandexGPT
        console.log('✅ YandexGPT успешно обработал изображение (Vision + GPT)');
        console.log('📝 Найденный текст:', gptData.totalText?.substring(0, 100) + '...');
        console.log('📊 Количество слов:', gptData.totalWords);
        console.log('🎯 Источник:', gptData.source);
        
        // Преобразуем в формат приложения (добавляем fontSize)
        const words = gptData.words.map(word => ({
          text: word.text,
          category: word.category,
          bbox: word.bbox, // Координаты от Vision API
          fontSize: 14 // Дефолтный размер
        }));
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          text: gptData.totalText,
          words: words,
          totalWords: gptData.totalWords,
          source: gptData.source
        }));
        
      } catch (error) {
        console.error('❌ Ошибка в analyze-image-gpt API:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Internal server error', details: error.message }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/api/analyze-image-vision') {
    // FALLBACK ENDPOINT: Yandex Vision API (ПРИОРИТЕТ 2)
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const { imageData, mimeType = 'image/jpeg' } = JSON.parse(body);
        
        if (!imageData) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Image data is required' }));
          return;
        }

        console.log('🔍 Анализируем изображение через Yandex Vision API (fallback)...');
        
        const visionData = await analyzeWithYandexVision(imageData, mimeType);
        
        // Логируем структуру ответа для отладки
        console.log('📦 Структура ответа Yandex Vision API:', JSON.stringify(visionData, null, 2).substring(0, 500));
        
        // ИСПРАВЛЕНО: правильная структура ответа Yandex Vision API
        if (visionData.results && visionData.results[0] && visionData.results[0].results && visionData.results[0].results[0] && visionData.results[0].results[0].textDetection) {
          const textDetection = visionData.results[0].results[0].textDetection;
          
          // Извлекаем весь текст из блоков с координатами
          const allText = [];
          const words = [];
          
          if (textDetection.pages && textDetection.pages[0]) {
            const page = textDetection.pages[0];
            
            if (page.blocks) {
              page.blocks.forEach((block) => {
                if (block.lines) {
                  block.lines.forEach((line) => {
                    if (line.words) {
                      line.words.forEach((word) => {
                        allText.push(word.text);
                        
                        // Преобразуем координаты из формата Yandex Vision в формат приложения
                        const vertices = word.boundingBox?.vertices || [];
                        if (vertices.length >= 4) {
                          const x0 = parseInt(vertices[0].x) || 0;
                          const y0 = parseInt(vertices[0].y) || 0;
                          const x1 = parseInt(vertices[2].x) || 0;
                          const y1 = parseInt(vertices[2].y) || 0;
                          
                          words.push({
                            text: word.text,
                            bbox: { x0, y0, x1, y1 },
                            confidence: word.confidence || 0
                          });
                        }
                      });
                    }
                  });
                }
              });
            }
          }

          console.log('✅ Yandex Vision API успешно обработал изображение');
          console.log('📝 Найденный текст:', allText.join(' ').substring(0, 100) + '...');
          console.log('📊 Количество слов:', words.length);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            text: allText.join(' '),
            words: words,
            totalWords: words.length
          }));

        } else {
          console.log('❌ Текст не найден в изображении');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            text: '',
            blocks: [],
            totalBlocks: 0,
            totalText: '',
            message: 'Текст не найден в изображении'
          }));
        }

      } catch (error) {
        console.error('❌ Ошибка Yandex Vision API:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'Internal server error',
          details: error.message 
        }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/api/classify-text') {
    // ENDPOINT: YandexGPT для классификации текста
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const { text, context } = JSON.parse(body);
        
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Text is required' }));
          return;
        }
        
        const apiKey = process.env.YANDEX_GPT_API_KEY?.trim();
        const folderId = process.env.YANDEX_FOLDER_ID?.trim();
        
        if (!apiKey || !folderId) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'YandexGPT API configuration missing' }));
          return;
        }
        
        const prompt = `Проанализируй следующий текст из меню ресторана и определи его тип:

Текст: "${text}"
Контекст: ${context || 'меню ресторана'}

Определи тип текста:
- "title" - название блюда, заголовок, название позиции в меню
- "price" - цена, стоимость, сумма
- "description" - описание блюда, ингредиенты, состав

Ответь только одним словом: title, price или description`;
        
        console.log('🤖 GPT классификация:', text.substring(0, 50) + '...');
        
        const result = await callYandexGPT(apiKey, folderId, prompt);
        
        // Логируем информацию об использовании токенов
        if (result.result?.usage) {
          const usage = result.result.usage
          console.log('💰 Использование токенов:')
          console.log(`   Input: ${usage.inputTextTokens || 0}, Output: ${usage.completionTokens || 0}, Total: ${usage.totalTokens || 0}`)
          const estimatedCost = ((usage.totalTokens || 0) / 1000) * 0.15
          console.log(`   📊 ~${estimatedCost.toFixed(4)}₽`)
        }
        
        const classification = result.result?.alternatives?.[0]?.message?.text?.trim().toLowerCase();
        
        // Валидация ответа
        const validTypes = ['title', 'price', 'description'];
        const finalType = validTypes.includes(classification) ? classification : 'description';
        
        console.log('✅ GPT классифицировал как:', finalType);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          text,
          type: finalType,
          confidence: 0.9,
          source: 'yandex-gpt'
        }));
        
      } catch (error) {
        console.error('❌ Ошибка классификации YandexGPT:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error', details: error.message }));
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

