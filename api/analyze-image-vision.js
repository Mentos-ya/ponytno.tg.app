// Yandex Vision API для анализа изображений
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const { imageData, mimeType = 'image/jpeg' } = req.body

    if (!imageData) {
      res.status(400).json({ error: 'Image data is required' })
      return
    }

    // Используем Yandex Vision API
    const apiKey = process.env.YANDEX_VISION_API_KEY
    const folderId = process.env.YANDEX_FOLDER_ID?.trim()

    if (!apiKey || !folderId) {
      res.status(500).json({ error: 'Yandex Vision API configuration missing' })
      return
    }

    console.log('🔍 Анализируем изображение через Yandex Vision API...')

    // Убираем data:image/jpeg;base64, если есть
    const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData

    const visionResponse = await fetch('https://vision.api.cloud.yandex.net/vision/v1/batchAnalyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${apiKey}`
      },
      body: JSON.stringify({
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
    })

    if (!visionResponse.ok) {
      const errorData = await visionResponse.text()
      console.error('Vision API error:', errorData)
      res.status(visionResponse.status).json({ 
        error: 'Vision API failed', 
        details: errorData 
      })
      return
    }

    const visionData = await visionResponse.json()
    console.log('✅ Vision API ответ получен')

    // Обрабатываем результат
    if (visionData.results && visionData.results[0] && visionData.results[0].textDetection) {
      const textDetection = visionData.results[0].textDetection
      
      // Извлекаем весь текст из блоков
      const allText = []
      const textBlocks = []
      
      if (textDetection.pages && textDetection.pages[0]) {
        const page = textDetection.pages[0]
        
        if (page.blocks) {
          page.blocks.forEach((block, blockIndex) => {
            if (block.lines) {
              const blockText = block.lines.map(line => 
                line.words?.map(word => word.text).join(' ') || ''
              ).join(' ')
              
              if (blockText.trim()) {
                allText.push(blockText)
                textBlocks.push({
                  id: blockIndex,
                  text: blockText,
                  confidence: block.lines[0]?.words?.[0]?.confidence || 0
                })
              }
            }
          })
        }
      }

      res.status(200).json({
        success: true,
        text: allText.join('\n'),
        blocks: textBlocks,
        totalBlocks: textBlocks.length,
        totalText: allText.join(' ')
      })

    } else {
      console.log('❌ Текст не найден в изображении')
      res.status(200).json({
        success: false,
        text: '',
        blocks: [],
        totalBlocks: 0,
        totalText: '',
        message: 'Текст не найден в изображении'
      })
    }

  } catch (error) {
    console.error('Error in analyze-image-vision API:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

