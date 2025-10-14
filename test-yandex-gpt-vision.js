#!/usr/bin/env node

// Загружаем переменные окружения
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Тестируем Yandex GPT Vision API для сканирования изображений
async function testYandexGPTVision() {
  console.log('🔍 Тестирование Yandex GPT Vision API...\n');
  
  const apiKey = process.env.YANDEX_GPT_API_KEY;
  const folderId = process.env.YANDEX_FOLDER_ID;
  
  if (!apiKey || !folderId) {
    console.log('❌ Переменные окружения не настроены');
    return;
  }
  
  console.log('✅ API ключ:', apiKey.substring(0, 10) + '...');
  console.log('✅ Folder ID:', folderId);
  
  // Тестовое изображение (base64) - можно заменить на реальное
  const testImageBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';
  
  const prompt = `Проанализируй это изображение меню ресторана и найди все блюда с ценами. 
  Верни результат в формате JSON:
  {
    "dishes": [
      {
        "name": "название блюда",
        "price": "цена",
        "description": "описание блюда"
      }
    ]
  }`;

  try {
    console.log('\n📤 Отправляем запрос к Yandex GPT Vision...');
    
    const response = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${apiKey}`
      },
      body: JSON.stringify({
        modelUri: `gpt://${folderId}/yandexgpt`,
        completionOptions: {
          stream: false,
          temperature: 0.1,
          maxTokens: 1000
        },
        messages: [
          {
            role: 'user',
            text: prompt,
            attachments: [
              {
                type: 'image_url',
                image_url: {
                  url: testImageBase64
                }
              }
            ]
          }
        ]
      })
    });
    
    console.log('📊 Статус ответа:', response.status);
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Ответ Yandex GPT Vision:', JSON.stringify(result, null, 2));
      
      if (result.result && result.result.alternatives && result.result.alternatives[0]) {
        const analysis = result.result.alternatives[0].text;
        console.log('🎯 Анализ изображения:', analysis);
      }
    } else {
      const errorText = await response.text();
      console.log('❌ Ошибка API:', response.status, errorText);
    }
    
  } catch (error) {
    console.log('❌ Ошибка запроса:', error.message);
  }
}

testYandexGPTVision().catch(console.error);
