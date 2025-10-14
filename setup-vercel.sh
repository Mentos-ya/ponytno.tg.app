#!/bin/bash

# Скрипт для настройки Vercel CLI
echo "🔧 Настройка Vercel CLI..."

# Проверяем, установлен ли Vercel CLI
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI не установлен"
    echo "📥 Установка Vercel CLI..."
    npm install -g vercel
fi

echo "✅ Vercel CLI установлен"

# Авторизация в Vercel
echo "🔑 Авторизация в Vercel..."
vercel login

# Проверяем авторизацию
echo "🔍 Проверка авторизации..."
vercel whoami

echo "✅ Vercel CLI настроен!"
echo ""
echo "🚀 Теперь можно использовать команды:"
echo "   - vercel --yes (деплой в превью)"
echo "   - vercel --prod --yes (деплой в продакшн)"
echo "   - vercel env add (добавление переменных окружения)"
echo "   - vercel env ls (просмотр переменных окружения)"
echo "   - vercel logs (просмотр логов)"

