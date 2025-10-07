// Используем встроенный fetch в Vercel

export default async function handler(req, res) {
  console.log('analyze-text-gpt endpoint called', { method: req.method, hasBody: !!req.body })
  
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const { imageBase64 } = req.body

    if (!imageBase64) {
      console.log('No imageBase64 provided')
      res.status(400).json({ error: 'Image data is required' })
      return
    }

    const apiKey = process.env.YANDEX_VISION_API_KEY
    const folderId = process.env.YANDEX_FOLDER_ID

    if (!apiKey) {
      console.log('No Yandex Vision API key configured')
      res.status(500).json({ error: 'Yandex Vision API Key not configured' })
      return
    }

    if (!folderId) {
      console.log('No Yandex Folder ID configured')
      res.status(500).json({ error: 'Yandex Folder ID not configured' })
      return
    }
    
    console.log('API configuration found, processing image...')

    // Убираем data:image/jpeg;base64, префикс если есть
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '')
    
    console.log('Image data length:', cleanBase64.length)

    // Проверяем размер изображения
    if (cleanBase64.length > 10 * 1024 * 1024) { // 10MB limit
      console.log('Image too large:', cleanBase64.length)
      res.status(400).json({ error: 'Image too large. Maximum size is 10MB.' })
      return
    }

    console.log('Sending request to Yandex Vision API...')
    const visionResponse = await fetch('https://vision.api.cloud.yandex.net/vision/v1/batchAnalyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${apiKey}`
      },
      body: JSON.stringify({
        analyze_specs: [{
          content: cleanBase64,
          features: [{
            type: 'TEXT_DETECTION',
            text_detection_config: {
              language_codes: ['en', 'ru', 'de', 'fr', 'es', 'it', 'pt', 'zh', 'ja', 'ko'],
              model: 'page'
            }
          }]
        }]
      })
    })

    if (!visionResponse.ok) {
      const errorText = await visionResponse.text()
      console.error('Yandex Vision API error:', visionResponse.status, errorText)
      console.error('Response headers:', Object.fromEntries(visionResponse.headers.entries()))
      
      // Возвращаем более информативную ошибку
      let errorMessage = 'Vision analysis failed'
      if (visionResponse.status === 401) {
        errorMessage = 'Invalid API key or authentication failed'
      } else if (visionResponse.status === 403) {
        errorMessage = 'API access forbidden or quota exceeded'
      } else if (visionResponse.status === 400) {
        errorMessage = 'Invalid image format or size'
      }
      
      res.status(visionResponse.status).json({ 
        error: errorMessage, 
        details: errorText,
        status: visionResponse.status
      })
      return
    }
    
    console.log('Vision API response received, parsing...')

    let visionData
    try {
      visionData = await visionResponse.json()
      console.log('Vision API response parsed successfully')
    } catch (parseError) {
      console.error('Failed to parse Vision API response:', parseError)
      res.status(500).json({ error: 'Failed to parse Vision API response', details: parseError.message })
      return
    }

    if (visionData.results && visionData.results[0] && visionData.results[0].results) {
      const textDetection = visionData.results[0].results[0]
      
      if (textDetection.textDetection && textDetection.textDetection.pages) {
        const pages = textDetection.textDetection.pages
        
        // Обрабатываем все страницы
        const allBlocks = []
        
        for (const page of pages) {
          if (page.blocks) {
            for (const block of page.blocks) {
              if (block.lines) {
                for (const line of block.lines) {
                  if (line.words) {
                    // Собираем текст строки
                    const lineText = line.words.map(word => word.text).join(' ')
                    
                    // Получаем координаты строки
                    const boundingBox = line.boundingBox
                    
                    if (lineText.trim()) {
                      allBlocks.push({
                        text: lineText.trim(),
                        boundingBox: {
                          x0: boundingBox.vertices[0].x,
                          y0: boundingBox.vertices[0].y,
                          x1: boundingBox.vertices[2].x,
                          y1: boundingBox.vertices[2].y
                        },
                        confidence: line.words.reduce((sum, word) => sum + (word.confidence || 0), 0) / line.words.length
                      })
                    }
                  }
                }
              }
            }
          }
        }

        console.log('Total blocks from Vision API:', allBlocks.length)

        // Если нет блоков, возвращаем пустой результат
        if (allBlocks.length === 0) {
          res.status(200).json({
            success: true,
            blocks: { titles: [], prices: [], descriptions: [] },
            totalBlocks: 0,
            source: 'yandex-vision',
            message: 'No text detected in image'
          })
          return
        }

        // Используем GPT для классификации каждого блока
        const classifiedBlocks = {
          titles: [],
          prices: [],
          descriptions: []
        }

        // Классифицируем каждый блок через GPT
        for (const block of allBlocks) {
          try {
            console.log('Classifying block with GPT:', block.text)
            
            const classifyResponse = await fetch(`${req.headers.origin || 'http://localhost:3000'}/api/classify-text`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                text: block.text,
                context: 'restaurant menu'
              })
            })

            if (classifyResponse.ok) {
              const classification = await classifyResponse.json()
              console.log('GPT classification result:', classification)
              
              switch (classification.type) {
                case 'title':
                  classifiedBlocks.titles.push(block)
                  break
                case 'price':
                  classifiedBlocks.prices.push(block)
                  break
                case 'description':
                  classifiedBlocks.descriptions.push(block)
                  break
              }
            } else {
              console.log('GPT classification failed, using fallback')
              // Fallback к простой классификации
              if (/\d/.test(block.text) && block.text.length < 10) {
                classifiedBlocks.prices.push(block)
              } else if (block.text.length < 30) {
                classifiedBlocks.titles.push(block)
              } else {
                classifiedBlocks.descriptions.push(block)
              }
            }
          } catch (error) {
            console.error('Error classifying block:', error)
            // Fallback к простой классификации
            if (/\d/.test(block.text) && block.text.length < 10) {
              classifiedBlocks.prices.push(block)
            } else if (block.text.length < 30) {
              classifiedBlocks.titles.push(block)
            } else {
              classifiedBlocks.descriptions.push(block)
            }
          }
        }

        console.log('GPT classification result:', {
          titles: classifiedBlocks.titles.length,
          prices: classifiedBlocks.prices.length,
          descriptions: classifiedBlocks.descriptions.length
        })

        res.status(200).json({
          success: true,
          blocks: classifiedBlocks,
          totalBlocks: allBlocks.length,
          source: 'yandex-gpt'
        })
      } else {
        res.status(200).json({
          success: true,
          blocks: { titles: [], prices: [], descriptions: [] },
          totalBlocks: 0,
          source: 'yandex-vision',
          message: 'No text detected in image'
        })
      }
    } else {
      res.status(200).json({
        success: true,
        blocks: { titles: [], prices: [], descriptions: [] },
        totalBlocks: 0,
        source: 'yandex-vision',
        message: 'Invalid response from Vision API'
      })
    }

  } catch (error) {
    console.error('Server error during text analysis:', error)
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }
}
