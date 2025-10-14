#!/usr/bin/env node

// Загружаем переменные окружения
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Скрипт для проверки статуса API endpoints
import https from 'https';
import http from 'http';

const BASE_URL = process.env.BASE_URL || 'https://ponyatno-miniapp-preview.vercel.app';

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    
    const req = client.request(url, { method: 'GET' }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: data
        });
      });
    });
    
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.end();
  });
}

async function checkAPI() {
  console.log('🔍 Проверка API endpoints...\n');
  
  const endpoints = [
    { name: 'Главная страница', url: `${BASE_URL}/` },
    { name: 'API: analyze-text', url: `${BASE_URL}/api/analyze-text` },
    { name: 'API: analyze-text-gpt', url: `${BASE_URL}/api/analyze-text-gpt` },
    { name: 'API: classify-text', url: `${BASE_URL}/api/classify-text` }
  ];
  
  for (const endpoint of endpoints) {
    try {
      console.log(`📡 ${endpoint.name}:`);
      const response = await makeRequest(endpoint.url);
      
      if (response.status === 200) {
        console.log(`   ✅ Статус: ${response.status} OK`);
      } else if (response.status === 405) {
        console.log(`   ⚠️  Статус: ${response.status} Method Not Allowed (ожидаемо для API)`);
      } else {
        console.log(`   ❌ Статус: ${response.status}`);
      }
      
      // Проверяем заголовки
      if (response.headers['content-type']) {
        console.log(`   📄 Content-Type: ${response.headers['content-type']}`);
      }
      
    } catch (error) {
      console.log(`   ❌ Ошибка: ${error.message}`);
    }
    
    console.log('');
  }
  
  console.log('🔧 Проверка переменных окружения:');
  console.log('   YANDEX_VISION_API_KEY:', process.env.YANDEX_VISION_API_KEY ? '✅ Настроен' : '❌ Не настроен');
  console.log('   YANDEX_FOLDER_ID:', process.env.YANDEX_FOLDER_ID ? '✅ Настроен' : '❌ Не настроен');
}

checkAPI().catch(console.error);
