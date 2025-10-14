#!/usr/bin/env node

// Загружаем переменные окружения
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Тестируем Yandex GPT API
async function testYandexGPT() {
  console.log('🔍 Тестирование Yandex GPT API...\n');
  
  const apiKey = process.env.YANDEX_GPT_API_KEY;
  const folderId = process.env.YANDEX_FOLDER_ID;
  
  if (!apiKey || !folderId) {
    console.log('❌ Переменные окружения не настроены');
    return;
  }
  
  console.log('✅ API ключ:', apiKey.substring(0, 10) + '...');
  console.log('✅ Folder ID:', folderId);
  
  const testText = "DOUBLE CHEESEBURGER";
  
  const prompt = `Проанализируй следующий текст из меню ресторана и определи его тип:

Текст: "${testText}"
Контекст: меню ресторана

Определи тип текста:
- "title" - название блюда, заголовок, название позиции в меню
- "price" - цена, стоимость, сумма
- "description" - описание блюда, ингредиенты, состав

Ответь только одним словом: title, price или description`;

  try {
    console.log('\n📤 Отправляем запрос к Yandex GPT...');
    
    const response = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${apiKey}`
      },
      body: JSON.stringify({
        modelUri: `gpt://${folderId}/yandexgpt/latest`,
        completionOptions: {
          stream: false,
          temperature: 0.1,
          maxTokens: 10
        },
        messages: [
          {
            role: 'user',
            text: prompt
          }
        ]
      })
    });
    
    console.log('📊 Статус ответа:', response.status);
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Ответ Yandex GPT:', result);
      
      if (result.result && result.result.alternatives && result.result.alternatives[0]) {
        const classification = result.result.alternatives[0].text.trim();
        console.log('🎯 Классификация:', classification);
      }
    } else {
      const errorText = await response.text();
      console.log('❌ Ошибка API:', response.status, errorText);
    }
    
  } catch (error) {
    console.log('❌ Ошибка запроса:', error.message);
  }
}

testYandexGPT().catch(console.error);
