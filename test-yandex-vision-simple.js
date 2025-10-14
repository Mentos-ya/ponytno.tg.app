#!/usr/bin/env node

// Загружаем переменные окружения
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Тестируем Yandex Vision API для анализа изображений
async function testYandexVision() {
  console.log('🔍 Тестирование Yandex Vision API...\n');
  
  const apiKey = process.env.YANDEX_VISION_API_KEY;
  const folderId = process.env.YANDEX_FOLDER_ID?.trim();
  
  if (!apiKey || !folderId) {
    console.log('❌ Переменные окружения не настроены');
    return;
  }
  
  console.log('✅ API ключ:', apiKey.substring(0, 10) + '...');
  console.log('✅ Folder ID:', folderId);
  
  // Тестовое изображение (base64) - можно заменить на реальное
  const testImageBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';
  
  try {
    console.log('\n📤 Отправляем запрос к Yandex Vision API...');
    
    const response = await fetch('https://vision.api.cloud.yandex.net/vision/v1/batchAnalyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${apiKey}`
      },
      body: JSON.stringify({
        folderId: folderId,
        analyze_specs: [
          {
            content: testImageBase64.split(',')[1], // убираем data:image/jpeg;base64,
            features: [
              {
                type: 'TEXT_DETECTION',
                text_detection_config: {
                  language_codes: ['ru', 'en']
                }
              },
            ]
          }
        ]
      })
    });
    
    console.log('📊 Статус ответа:', response.status);
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Ответ Yandex Vision API:', JSON.stringify(result, null, 2));
      
      if (result.results && result.results[0]) {
        const analysis = result.results[0];
        console.log('🎯 Анализ изображения:');
        console.log('- Текст:', analysis.textDetection?.pages?.[0]?.blocks?.length || 0, 'блоков');
        console.log('- Объекты:', analysis.objectDetection?.objects?.length || 0, 'объектов');
      }
    } else {
      const errorText = await response.text();
      console.log('❌ Ошибка API:', response.status, errorText);
    }
    
  } catch (error) {
    console.log('❌ Ошибка запроса:', error.message);
  }
}

testYandexVision().catch(console.error);
