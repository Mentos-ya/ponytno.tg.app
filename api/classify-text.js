// AI-классификатор для умного определения типа текста
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const { text, context } = req.body

    if (!text) {
      res.status(400).json({ error: 'Text is required' })
      return
    }

    // Используем Yandex GPT для классификации
    const apiKey = process.env.YANDEX_VISION_API_KEY // Используем тот же ключ
    const folderId = process.env.YANDEX_FOLDER_ID

    if (!apiKey || !folderId) {
      res.status(500).json({ error: 'Yandex API configuration missing' })
      return
    }

    const prompt = `Проанализируй следующий текст из меню ресторана и определи его тип:

Текст: "${text}"
Контекст: ${context || 'меню ресторана'}

Определи тип текста:
- "title" - название блюда, заголовок, название позиции в меню
- "price" - цена, стоимость, сумма
- "description" - описание блюда, ингредиенты, состав

Ответь только одним словом: title, price или description`

    console.log('Sending to Yandex GPT:', { text, context })

    const gptResponse = await fetch('https://llm.api.cloud.yandex.net/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${apiKey}`
      },
      body: JSON.stringify({
        model: `gpt://${folderId}/yandexgpt/rc`,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 10
      })
    })

    if (!gptResponse.ok) {
      const errorText = await gptResponse.text()
      console.error('Yandex GPT error:', gptResponse.status, errorText)
      res.status(gptResponse.status).json({ error: 'GPT classification failed', details: errorText })
      return
    }

    const gptData = await gptResponse.json()
    const classification = gptData.choices?.[0]?.message?.content?.trim().toLowerCase()

    console.log('GPT response:', { text, classification })

    // Валидация ответа
    const validTypes = ['title', 'price', 'description']
    const finalType = validTypes.includes(classification) ? classification : 'description'

    res.status(200).json({
      success: true,
      text,
      type: finalType,
      confidence: 0.9,
      source: 'yandex-gpt'
    })

  } catch (error) {
    console.error('Classification error:', error)
    res.status(500).json({ error: 'Internal server error', details: error.message })
  }
}
