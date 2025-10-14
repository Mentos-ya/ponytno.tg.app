#!/usr/bin/env node

// Создаем простое тестовое изображение с текстом меню
import fs from 'fs';
import { createCanvas } from 'canvas';

async function createTestMenuImage() {
  try {
    // Создаем canvas 400x300
    const canvas = createCanvas(400, 300);
    const ctx = canvas.getContext('2d');
    
    // Белый фон
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 400, 300);
    
    // Черный текст
    ctx.fillStyle = 'black';
    ctx.font = 'bold 24px Arial';
    
    // Заголовок
    ctx.fillText('МЕНЮ РЕСТОРАНА', 50, 50);
    
    // Блюда
    ctx.font = 'bold 18px Arial';
    ctx.fillText('БОРЩ УКРАИНСКИЙ', 50, 100);
    ctx.fillText('250 ₽', 300, 100);
    
    ctx.fillText('КУРИЦА ПО-ФРАНЦУЗСКИ', 50, 130);
    ctx.fillText('350 ₽', 300, 130);
    
    ctx.fillText('ПИЦЦА МАРГАРИТА', 50, 160);
    ctx.fillText('450 ₽', 300, 160);
    
    ctx.font = '14px Arial';
    ctx.fillText('Свежие овощи, мясо, специи', 50, 190);
    ctx.fillText('Курица, сыр, грибы', 50, 210);
    ctx.fillText('Томаты, моцарелла, базилик', 50, 230);
    
    // Сохраняем как JPEG
    const buffer = canvas.toBuffer('image/jpeg');
    fs.writeFileSync('tests/fixtures/test-menu.jpg', buffer);
    
    console.log('✅ Создано тестовое изображение меню: tests/fixtures/test-menu.jpg');
    console.log('📏 Размер:', buffer.length, 'байт');
    
  } catch (error) {
    console.log('❌ Ошибка создания изображения:', error.message);
    console.log('💡 Установите canvas: npm install canvas');
  }
}

createTestMenuImage();

