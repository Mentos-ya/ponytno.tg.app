#!/bin/bash
# Скрипт для получения логов без ожидания
vercel logs https://ponyatno-miniapp-preview.vercel.app &
PID=$!
sleep 3
kill $PID 2>/dev/null
wait $PID 2>/dev/null
