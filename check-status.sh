#!/bin/bash

# Скрипт для проверки статуса проекта
# Использовать при открытии нового чата с агентом

echo "🔍 Проверка статуса проекта Понятно MiniApp TG"
echo "=============================================="

# Проверка git статуса
echo "📋 Git статус:"
git status --porcelain
echo ""

# Проверка лог-сервера
echo "🌐 Проверка лог-сервера:"
if curl -s http://localhost:3030/health > /dev/null; then
    echo "✅ Лог-сервер работает на порту 3030"
else
    echo "❌ Лог-сервер НЕ работает на порту 3030"
    echo "💡 Запустите: node log-server.cjs &"
fi
echo ""

# Проверка последних логов
echo "📊 Последние логи:"
if ls logs/log-server-*.log 1> /dev/null 2>&1; then
    echo "Последние 5 строк логов:"
    tail -n 5 logs/log-server-*.log | grep -E "\[(LOG|ERROR|WARN|INFO)\]" | tail -3
else
    echo "❌ Файлы логов не найдены"
fi
echo ""

# Проверка портов
echo "🔌 Используемые порты:"
lsof -i :3030 2>/dev/null || echo "Порт 3030 свободен"
echo ""

# Проверка файлов проекта
echo "📁 Критические файлы:"
[ -f "index.html" ] && echo "✅ index.html (фильтрация ошибок)" || echo "❌ index.html отсутствует"
[ -f "src/App.tsx" ] && echo "✅ src/App.tsx (основной компонент)" || echo "❌ src/App.tsx отсутствует"
[ -f "log-server.cjs" ] && echo "✅ log-server.cjs (сервер логов)" || echo "❌ log-server.cjs отсутствует"
[ -f "AGENT_CONTEXT.md" ] && echo "✅ AGENT_CONTEXT.md (контекст для агентов)" || echo "❌ AGENT_CONTEXT.md отсутствует"
echo ""

echo "🎯 Рекомендации:"
echo "1. Прочитайте AGENT_CONTEXT.md"
echo "2. НЕ ЛОМАЙТЕ СУЩЕСТВУЮЩИЙ КОД!"
echo "3. Используйте встроенный браузер Cursor для чтения логов"
echo "4. НЕ ДЕПЛОЙТЕ В VERCEL БЕЗ КОМАНДЫ ПОЛЬЗОВАТЕЛЯ!"
echo "5. Работайте только с локальным хостом http://localhost:3030"
echo ""

echo "✅ Проверка завершена"
