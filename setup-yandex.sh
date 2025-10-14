#!/bin/bash

# Скрипт для настройки Yandex Cloud CLI
echo "🔧 Настройка Yandex Cloud CLI..."

# Проверяем, установлен ли yc CLI
if ! command -v yc &> /dev/null; then
    echo "❌ Yandex Cloud CLI не установлен"
    echo "📥 Установка Yandex Cloud CLI..."
    
    # Установка для macOS
    if [[ "$OSTYPE" == "darwin"* ]]; then
        curl -sSL https://storage.yandexcloud.net/yandexcloud-yc/install.sh | bash
        source ~/.bashrc
    else
        echo "❌ Автоматическая установка поддерживается только для macOS"
        echo "📖 Инструкции по установке: https://cloud.yandex.ru/docs/cli/quickstart"
        exit 1
    fi
fi

echo "✅ Yandex Cloud CLI установлен"

# Создаем профиль по умолчанию
echo "🔑 Создание профиля по умолчанию..."
yc config profile create default

# Запрашиваем токен
echo "🔐 Введите ваш OAuth токен от Yandex Cloud:"
echo "📖 Получить токен: https://oauth.yandex.ru/authorize?response_type=token&client_id=1a6990aa636648e9b2ef855fa7bec2fb"
read -p "Токен: " TOKEN

if [ -z "$TOKEN" ]; then
    echo "❌ Токен не может быть пустым"
    exit 1
fi

# Устанавливаем токен
yc config set token $TOKEN

# Запрашиваем ID папки
echo "📁 Введите ID папки в Yandex Cloud:"
echo "📖 Найти ID папки: https://console.cloud.yandex.ru/folders"
read -p "ID папки: " FOLDER_ID

if [ -z "$FOLDER_ID" ]; then
    echo "❌ ID папки не может быть пустым"
    exit 1
fi

# Устанавливаем ID папки
yc config set folder-id $FOLDER_ID

# Проверяем настройки
echo "🔍 Проверка настроек..."
yc config list

echo "✅ Yandex Cloud CLI настроен!"
echo "📋 Сохраненные настройки:"
echo "   - Токен: ${TOKEN:0:10}..."
echo "   - ID папки: $FOLDER_ID"
echo ""
echo "🚀 Теперь можно использовать команды:"
echo "   - yc iam service-account list"
echo "   - yc vision api-key list"
echo "   - yc resource-manager folder list"

