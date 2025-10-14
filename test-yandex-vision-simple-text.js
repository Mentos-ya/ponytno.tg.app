#!/usr/bin/env node

// Загружаем переменные окружения
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Тестируем Yandex Vision API с простым текстом
async function testYandexVisionSimpleText() {
  console.log('🔍 Тестирование Yandex Vision API с простым текстом...\n');
  
  const apiKey = process.env.YANDEX_VISION_API_KEY;
  const folderId = process.env.YANDEX_FOLDER_ID?.trim();
  
  if (!apiKey || !folderId) {
    console.log('❌ Переменные окружения не настроены');
    return;
  }
  
  console.log('✅ API ключ:', apiKey.substring(0, 10) + '...');
  console.log('✅ Folder ID:', folderId);
  
  // Создаем простое изображение с текстом через base64
  // Простое изображение 1x1 пиксель с текстом "TEST"
  const simpleImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  
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
            content: simpleImageBase64.split(',')[1], // убираем data:image/png;base64,
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
    });
    
    console.log('📊 Статус ответа:', response.status);
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Ответ Yandex Vision API получен!');
      console.log('📄 Результат:', JSON.stringify(result, null, 2));
      
      if (result.results && result.results[0] && result.results[0].textDetection) {
        const textDetection = result.results[0].textDetection;
        console.log('🎯 Анализ изображения:');
        console.log('- Страниц:', textDetection.pages?.length || 0);
        
        if (textDetection.pages && textDetection.pages[0]) {
          const page = textDetection.pages[0];
          console.log('- Блоков текста:', page.blocks?.length || 0);
          console.log('- Строк:', page.lines?.length || 0);
          console.log('- Слов:', page.words?.length || 0);
          
          // Показываем найденный текст
          if (page.blocks && page.blocks.length > 0) {
            console.log('\n📝 Найденный текст:');
            page.blocks.forEach((block, index) => {
              if (block.lines && block.lines.length > 0) {
                const blockText = block.lines.map(line => 
                  line.words?.map(word => word.text).join(' ') || ''
                ).join(' ');
                console.log(`Блок ${index + 1}: ${blockText}`);
              }
            });
          }
        }
      } else {
        console.log('❌ Текст не найден в изображении');
      }
    } else {
      const errorText = await response.text();
      console.log('❌ Ошибка API:', response.status, errorText);
    }
    
  } catch (error) {
    console.log('❌ Ошибка запроса:', error.message);
  }
}

testYandexVisionSimpleText().catch(console.error);

