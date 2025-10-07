#!/bin/bash

# Скрипт для настройки переменных окружения в Vercel
echo "🔧 Настройка переменных окружения в Vercel..."

# Проверяем, авторизован ли пользователь в Vercel
if ! vercel whoami &> /dev/null; then
    echo "❌ Не авторизован в Vercel. Запустите сначала: npm run vercel:login"
    exit 1
fi

echo "✅ Авторизован в Vercel"

# Добавляем YANDEX_VISION_API_KEY
echo "🔑 Настройка YANDEX_VISION_API_KEY..."
echo "📖 Получить API ключ: https://console.cloud.yandex.ru/iam/service-accounts"
read -p "Введите YANDEX_VISION_API_KEY: " VISION_API_KEY

if [ -z "$VISION_API_KEY" ]; then
    echo "❌ API ключ не может быть пустым"
    exit 1
fi

# Добавляем переменную в Vercel
vercel env add YANDEX_VISION_API_KEY production <<< "$VISION_API_KEY"
vercel env add YANDEX_VISION_API_KEY preview <<< "$VISION_API_KEY"

# Добавляем YANDEX_FOLDER_ID
echo "📁 Настройка YANDEX_FOLDER_ID..."
echo "📖 Найти ID папки: https://console.cloud.yandex.ru/folders"
read -p "Введите YANDEX_FOLDER_ID: " FOLDER_ID

if [ -z "$FOLDER_ID" ]; then
    echo "❌ ID папки не может быть пустым"
    exit 1
fi

# Добавляем переменную в Vercel
vercel env add YANDEX_FOLDER_ID production <<< "$FOLDER_ID"
vercel env add YANDEX_FOLDER_ID preview <<< "$FOLDER_ID"

echo "✅ Переменные окружения настроены!"
echo ""
echo "🔍 Проверка переменных:"
vercel env ls

echo ""
echo "🚀 Теперь можно деплоить:"
echo "   - npm run build (автоматический деплой в превью)"
echo "   - npm run deploy:prod (деплой в продакшн)"
