#!/bin/bash

# Скрипт для настройки alias в Vercel
echo "🔗 Настройка alias в Vercel..."

# Проверяем, авторизован ли пользователь в Vercel
if ! npx vercel whoami &> /dev/null; then
    echo "❌ Не авторизован в Vercel. Запустите сначала: npm run vercel:login"
    exit 1
fi

echo "✅ Авторизован в Vercel"

# Получаем последний успешный URL деплоя
echo "🔍 Получение последнего успешного URL деплоя..."
LAST_URL=$(npx vercel ls | grep "Ready" | head -n 1 | awk '{print $NF}')

if [ "$LAST_URL" = "null" ] || [ -z "$LAST_URL" ]; then
    echo "❌ Не удалось получить URL деплоя"
    exit 1
fi

echo "📡 Последний URL: $LAST_URL"

# Настраиваем alias для превью
echo "🔗 Настройка alias для превью..."
npx vercel alias set $LAST_URL ponyatno-miniapp-preview.vercel.app

if [ $? -eq 0 ]; then
    echo "✅ Alias для превью настроен: https://ponyatno-miniapp-preview.vercel.app"
else
    echo "❌ Ошибка настройки alias для превью"
fi

echo ""
echo "🚀 Теперь доступны URL-ы:"
echo "   - Превью: https://ponyatno-miniapp-preview.vercel.app"
echo "   - Последний деплой: https://$LAST_URL"
