import { useEffect, useRef, useState } from 'react'
import WebApp from '@twa-dev/sdk'
import Tesseract from 'tesseract.js'
import './App.css'

type OcrWord = { 
  bbox: { x0: number; y0: number; x1: number; y1: number }
  text: string
  fontSize: number
}
type OcrResult = { text: string; words: OcrWord[] }
type TextCategory = 'title' | 'description' | 'price'
type OcrProgressCallback = (progress: number) => void
type OcrProvider = {
  recognize: (imageUrl: string, onProgress?: OcrProgressCallback) => Promise<OcrResult>
}

// Перехватываем console.log для автоматической отправки на лог-сервер
const originalConsoleLog = console.log
const originalConsoleError = console.error
const sendToLogServer = (level: string, args: any[]) => {
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  const timestamp = new Date().toLocaleTimeString('ru-RU')
  fetch('http://localhost:3030/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `[${level}] ${message}`, timestamp })
  }).catch(() => {})
}

console.log = (...args: any[]) => {
  originalConsoleLog(...args)
  sendToLogServer('LOG', args)
}

console.error = (...args: any[]) => {
  originalConsoleError(...args)
  sendToLogServer('ERROR', args)
}

const tesseractProvider: OcrProvider = {
  async recognize(imageUrl, onProgress) {
    let d: any
    // ИСПОЛЬЗУЕМ ПРЯМОЙ ВЫЗОВ БЕЗ WORKER - для отладки
    console.log('Используем ПРЯМОЙ метод Tesseract.recognize без worker')
    try {
      const { data } = await Tesseract.recognize(imageUrl, 'eng+rus', {
        logger: (m: any) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            onProgress?.(m.progress)
            console.log('Прогресс:', Math.round(m.progress * 100) + '%')
          }
        },
      } as any)
      d = data as any
      console.log('✅ Tesseract вернул data')
      console.log('Ключи в data:', Object.keys(d || {}))
      console.log('data.blocks:', d?.blocks)
      console.log('data.words:', d?.words)
      console.log('data.lines:', d?.lines)
      console.log('data.paragraphs:', d?.paragraphs)
      
      if (d?.blocks && Array.isArray(d.blocks)) {
        console.log('✅ Блоков:', d.blocks.length)
      }
      if (d?.words && Array.isArray(d.words)) {
        console.log('✅ Слов:', d.words.length)
      }
      if (d?.lines && Array.isArray(d.lines)) {
        console.log('✅ Строк:', d.lines.length)
      }
    } catch (err) {
      console.error('❌ Tesseract.recognize упал:', err)
      throw err
    }
    let words: OcrWord[] = []
    
    // В v5 пробуем несколько источников
    // 1. Прямой доступ к data.words
    if (d?.words && Array.isArray(d.words)) {
      console.log('Извлекаем из data.words напрямую')
      words = d.words.filter((w: any) => w.bbox).map((w: any) => ({
        bbox: w.bbox,
        text: w.text || '',
        fontSize: w.bbox ? Math.abs(w.bbox.y1 - w.bbox.y0) : 0
      }))
      console.log('Извлечено из data.words:', words.length)
    }
    
    // 2. Если нет, идём через blocks -> paragraphs -> lines -> words
    if (words.length === 0 && d?.blocks && Array.isArray(d.blocks)) {
      console.log('Извлекаем из blocks иерархии')
      for (const block of d.blocks) {
        if (block.paragraphs && Array.isArray(block.paragraphs)) {
          for (const para of block.paragraphs) {
            if (para.lines && Array.isArray(para.lines)) {
              for (const line of para.lines) {
                if (line.words && Array.isArray(line.words)) {
                  for (const word of line.words) {
                    if (word.bbox) {
                      words.push({
                        bbox: word.bbox,
                        text: word.text || '',
                        fontSize: word.bbox ? Math.abs(word.bbox.y1 - word.bbox.y0) : 0
                      })
                    }
                  }
                }
              }
            }
          }
        }
      }
      console.log('Извлечено из blocks:', words.length)
    }
    
    // 3. Fallback: используем lines как блоки
    if (words.length === 0) {
      console.log('Fallback: используем lines/paragraphs')
      const lines = (d?.lines as { bbox: OcrWord['bbox'], text?: string }[]) || []
      const paras = (d?.paragraphs as { bbox: OcrWord['bbox'], text?: string }[]) || []
      console.log('Найдено:', { lines: lines.length, paras: paras.length })
      words = [
        ...lines.map(l => ({ 
          bbox: l.bbox, 
          text: l.text || '', 
          fontSize: l.bbox ? Math.abs(l.bbox.y1 - l.bbox.y0) : 0 
        })), 
        ...paras.map(p => ({ 
          bbox: p.bbox, 
          text: p.text || '', 
          fontSize: p.bbox ? Math.abs(p.bbox.y1 - p.bbox.y0) : 0 
        }))
      ]
      console.log('Итого после fallback:', words.length)
    }
    
    return { text: d?.text || '', words }
  },
}

// Mock-провайдер для e2e-тестов (?mockOcr=1): возвращает фиксированные bbox
const mockProvider: OcrProvider = {
  async recognize(_imageUrl: string) {
    // Нормализованные координаты (0..1) для 3 блоков текста
    const words = [
      { bbox: { x0: 0.08, y0: 0.10, x1: 0.92, y1: 0.18 }, text: 'TITLE', fontSize: 0.08 },
      { bbox: { x0: 0.10, y0: 0.45, x1: 0.88, y1: 0.53 }, text: 'description text', fontSize: 0.08 },
      { bbox: { x0: 0.12, y0: 0.78, x1: 0.85, y1: 0.86 }, text: '299₽', fontSize: 0.08 },
    ]
    return { text: '', words }
  },
}

// Классификация текста на категории
function classifyText(word: OcrWord, allWords: OcrWord[]): TextCategory {
  const text = word.text.trim()
  
  // Если пустой текст - считаем описанием
  if (!text) return 'description'
  
  // 1. Определяем цену: содержит цифры + возможно валюту
  const hasDigits = /\d/.test(text)
  const hasCurrency = /[₽$€£¥]|руб|usd|eur|gbp|p\b|р\b/i.test(text)
  const isPriceFormat = /^\d+[\s.,]?\d*[\s₽$€£¥рp]?$|^\d+\s*(руб|usd|eur)/i.test(text)
  
  if (hasDigits && (hasCurrency || isPriceFormat || text.length <= 10)) {
    return 'price'
  }
  
  // 2. Определяем заголовок по признакам:
  
  // a) Весь текст в верхнем регистре и есть буквы
  const hasLetters = /[a-zа-яё]/i.test(text)
  const isAllCaps = hasLetters && text === text.toUpperCase() && text.length > 1
  
  // b) Размер шрифта больше среднего
  const avgFontSize = allWords.length > 0 
    ? allWords.reduce((sum, w) => sum + w.fontSize, 0) / allWords.length 
    : 0
  const isLargeFont = word.fontSize > avgFontSize * 1.2
  
  // c) Находится в верхней трети изображения
  const isTopPosition = word.bbox.y0 < 0.35
  
  // Если хотя бы 2 признака совпадают - это заголовок
  const titleScore = [isAllCaps, isLargeFont, isTopPosition].filter(Boolean).length
  if (titleScore >= 2) {
    return 'title'
  }
  
  // 3. Если это только заголовок (большой размер и капс) - тоже заголовок
  if (isAllCaps || isLargeFont) {
    return 'title'
  }
  
  // 4. Всё остальное - описание
  return 'description'
}

// Цвета для категорий (яркие цвета с хорошей видимостью текста)
function getCategoryColor(category: TextCategory): string {
  switch (category) {
    case 'title': return 'rgba(255, 100, 100, 0.4)' // ярко-розовый, 40% непрозрачности
    case 'description': return 'rgba(255, 200, 50, 0.4)' // ярко-жёлтый, 40% непрозрачности
    case 'price': return 'rgba(100, 255, 100, 0.4)' // ярко-зелёный, 40% непрозрачности
  }
}

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const resultImgRef = useRef<HTMLImageElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [isOcrRunning, setIsOcrRunning] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  // Текст не отображаем — оставляем только подсветку на изображении
  const [imageDims, setImageDims] = useState<{
    naturalWidth: number
    naturalHeight: number
    displayWidth: number
    displayHeight: number
  } | null>(null)
  const [lastWords, setLastWords] = useState<OcrWord[]>([])
  const [debugEnabled] = useState(() => new URLSearchParams(window.location.search).has('debug'))
  const [testEnabled] = useState(() => new URLSearchParams(window.location.search).has('test'))
  const [showCameraOverlay, setShowCameraOverlay] = useState(false)

  const addLog = (message: string, data?: any) => {
    // console.log автоматически отправляет на лог-сервер благодаря перехватчику выше
    console.log(message, data !== undefined ? data : '')
  }

  useEffect(() => {
    try { localStorage.removeItem('thumbs_v1') } catch (_) {}
  }, [])

  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('read error'))
      reader.onload = () => resolve(String(reader.result))
      reader.readAsDataURL(file)
    })
  }

  const preprocessForOcr = (src: string, maxSide = 1400): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        const k = Math.min(1, maxSide / Math.max(width, height))
        width = Math.max(1, Math.round(width * k))
        height = Math.max(1, Math.round(height * k))
        const c = document.createElement('canvas')
        c.width = width
        c.height = height
        const ctx = c.getContext('2d')!
        ctx.drawImage(img, 0, 0, width, height)
        resolve(c.toDataURL('image/png'))
      }
      img.src = src
    })
  }

  useEffect(() => {
    // Инициализация Telegram WebApp SDK
    try {
      WebApp.ready()
      WebApp.expand()
    } catch (_) {
      // Работает и вне Telegram
    }

    return () => {
      // Остановка стрима при размонтировании
      const video = videoRef.current
      const stream = video?.srcObject as MediaStream | null
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // Автоматически открываем интерфейс камеры при входе
  useEffect(() => {
    setShowCameraOverlay(true)
  }, [])

  const startCamera = async () => {
    try {
      setShowCameraOverlay(true)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        setCameraError(null)
        try { await video.play() } catch (_) {}
        setCameraReady(true)
      }
    } catch (err) {
      setCameraError((err as Error)?.message || 'Не удалось получить доступ к камере')
      setCameraReady(false)
    }
  }

  useEffect(() => {
    if (showCameraOverlay) return
    const video = videoRef.current
    const stream = video?.srcObject as MediaStream | null
    stream?.getTracks().forEach((t) => t.stop())
    setCameraReady(false)
  }, [showCameraOverlay])

  const handleTakePhoto = async () => {
    if (!cameraReady) { await startCamera(); return }
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) return
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, width, height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    setImageUrl(dataUrl)
    setShowCameraOverlay(false)
  }

  const handlePickFromLibrary = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const input = e.currentTarget
    const dataUrl = await fileToDataUrl(file)
    // Используем исходное качество изображения без сжатия/даунскейла
    setImageUrl(dataUrl)
    // Закрываем оверлей камеры, чтобы показать выбранное изображение и запустить OCR
    setShowCameraOverlay(false)
    if (input) input.value = ''
  }

  // Запуск OCR при появлении изображения
  useEffect(() => {
    const recognize = async () => {
      addLog('OCR useEffect запущен', { hasImageUrl: !!imageUrl })
      if (!imageUrl) {
        addLog('imageUrl пустой, выход')
        return
      }
      addLog('Начинаем OCR')
      setIsOcrRunning(true)
      setOcrProgress(0)
      // Текст не сохраняем
      try {
        const useMock = new URLSearchParams(window.location.search).has('mockOcr')
        const provider = useMock ? mockProvider : tesseractProvider
        addLog('Провайдер выбран', useMock ? 'mock' : 'tesseract')
        // Предобработка для повышения качества OCR
        const ocrSrc = useMock ? imageUrl : await preprocessForOcr(imageUrl)
        addLog('Предобработка завершена, запускаем recognize')
        const result = await provider.recognize(ocrSrc, (p) => setOcrProgress(p))
        addLog('Распознанный текст', result.text.substring(0, 100) + '...')
        addLog('Количество распознанных слов', result.words.length)
        // Классифицируем и выводим в лог для отладки
        const classified = result.words.map(w => ({
          text: w.text,
          category: classifyText(w, result.words)
        }))
        addLog('Классифицированные слова:', classified)
        setLastWords(result.words)
        addLog('Слова сохранены, ждём imageDims для отрисовки')
      } catch (err) {
        addLog('ОШИБКА OCR', String(err))
        console.error('OCR error:', err)
      } finally {
        addLog('OCR завершён')
        setIsOcrRunning(false)
      }
    }
    recognize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl])

  const drawHighlights = (words: OcrWord[]) => {
    addLog('drawHighlights ВЫЗВАНА')
    const img = resultImgRef.current
    const canvas = overlayCanvasRef.current
    addLog('Проверка элементов', { 
      hasImg: !!img, 
      hasCanvas: !!canvas, 
      hasImageDims: !!imageDims 
    })
    if (!img || !canvas || !imageDims) {
      addLog('ВЫХОД: не все элементы готовы')
      return
    }
    const { naturalWidth, naturalHeight, displayWidth, displayHeight } = imageDims
    const scaleX = displayWidth / naturalWidth
    const scaleY = displayHeight / naturalHeight
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1))
    canvas.width = Math.max(1, Math.round(displayWidth * dpr))
    canvas.height = Math.max(1, Math.round(displayHeight * dpr))
    // Визуальный размер управляется стилями (уже 100%)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    addLog('Canvas готов', {
      wordsCount: words.length,
      displaySize: `${displayWidth}x${displayHeight}`,
      canvasSize: `${canvas.width}x${canvas.height}`
    })
    // Подсветка с прозрачностью
    ctx.globalCompositeOperation = 'source-over'
    
    requestAnimationFrame(() => {
      // Шаг 1: Конвертируем все bbox в экранные координаты
      interface WordRect {
        x: number
        y: number
        width: number
        height: number
        originalIndex: number
        category: TextCategory
        text: string
      }
      
      const wordRects: WordRect[] = words.map((w, idx) => {
        let { x0, y0, x1, y1 } = w.bbox
        const isNormalized = x1 <= 1 && y1 <= 1
        let x: number, y: number, width: number, height: number
        if (isNormalized) {
          x = x0 * displayWidth
          y = y0 * displayHeight
          width = (x1 - x0) * displayWidth
          height = (y1 - y0) * displayHeight
        } else {
          x = x0 * scaleX
          y = y0 * scaleY
          width = (x1 - x0) * scaleX
          height = (y1 - y0) * scaleY
        }
        // Классифицируем каждое слово
        const category = classifyText(w, words)
        return { x, y, width, height, originalIndex: idx, category, text: w.text }
      })
      
      // Отладка: выводим информацию о первых нескольких словах
      addLog('Отладка wordRects:', wordRects.slice(0, 5).map(r => ({
        text: r.text,
        category: r.category,
        coords: `${Math.round(r.x)},${Math.round(r.y)} - ${Math.round(r.width)}x${Math.round(r.height)}`,
        bbox: words[r.originalIndex].bbox
      })))
      
      // Шаг 2: Группируем слова по строкам (по Y-координатам)
      const lines: WordRect[][] = []
      const sortedByY = [...wordRects].sort((a, b) => a.y - b.y)
      
      for (const rect of sortedByY) {
        // Ищем строку, к которой принадлежит это слово
        let foundLine = false
        for (const line of lines) {
          const avgY = line.reduce((sum, r) => sum + r.y, 0) / line.length
          const avgHeight = line.reduce((sum, r) => sum + r.height, 0) / line.length
          // Если Y-координата отличается меньше чем на половину средней высоты - это та же строка
          if (Math.abs(rect.y - avgY) < avgHeight * 0.6) {
            line.push(rect)
            foundLine = true
            break
          }
        }
        if (!foundLine) {
          lines.push([rect])
        }
      }
      
      // Отладка: выводим информацию о строках
      addLog('Отладка строк:', lines.map((line, idx) => ({
        lineIndex: idx,
        wordsCount: line.length,
        words: line.map(w => w.text),
        yRange: `${Math.round(Math.min(...line.map(w => w.y)))}-${Math.round(Math.max(...line.map(w => w.y + w.height)))}`
      })))
      
      // Шаг 3: Для каждой строки находим общую высоту и Y-позицию
      const padding = 1 // минимальный отступ
      for (const line of lines) {
        // Находим минимальный Y и максимальный Y + height в строке
        const minY = Math.min(...line.map(r => r.y))
        const maxY = Math.max(...line.map(r => r.y + r.height))
        const lineHeight = maxY - minY
        
        // Рисуем каждое слово с одинаковой высотой и выравниванием
        for (const rect of line) {
          const x = Math.max(0, Math.round(rect.x - padding))
          const y = Math.max(0, Math.round(minY - padding))
          const width = Math.max(1, Math.round(rect.width + padding * 2))
          const height = Math.max(1, Math.round(lineHeight + padding * 2))
          // Устанавливаем цвет в зависимости от категории
          ctx.fillStyle = getCategoryColor(rect.category)
          ctx.fillRect(x, y, width, height)
        }
      }
      
      // Тест/отладка: отдаём метрики наружу
      canvas.dataset.wordsCount = String(words.length)
      canvas.dataset.canvasW = String(canvas.width)
      canvas.dataset.canvasH = String(canvas.height)
      canvas.dataset.imgW = String(displayWidth)
      canvas.dataset.imgH = String(displayHeight)
      if (testEnabled || debugEnabled) {
        ;(window as any).__overlayDebug = {
          wordsCount: words.length,
          imageDims,
          canvasSize: { width: canvas.width, height: canvas.height, dpr },
          linesCount: lines.length,
        }
      }
    })
  }

  // Перерисовывать подсветку, когда меняются размеры или слова
  useEffect(() => {
    addLog('useEffect: imageDims или lastWords изменились', {
      hasImageDims: !!imageDims,
      wordsCount: lastWords.length
    })
    if (imageDims && lastWords.length > 0) {
      addLog('Условия выполнены, вызываем drawHighlights')
      drawHighlights(lastWords)
    } else {
      addLog('Условия НЕ выполнены', {
        needImageDims: !imageDims,
        needWords: lastWords.length === 0
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageDims, lastWords])

  // Следим за изменением размеров изображения (влияет на overlay)
  useEffect(() => {
    const img = resultImgRef.current
    if (!img) return
    const ro = new ResizeObserver(() => {
      const displayWidth = img.clientWidth
      const displayHeight = img.clientHeight
      setImageDims({
        naturalWidth: img.naturalWidth || displayWidth,
        naturalHeight: img.naturalHeight || displayHeight,
        displayWidth,
        displayHeight,
      })
    })
    ro.observe(img)
    return () => ro.disconnect()
  }, [imageUrl])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      <h2 style={{ margin: 0 }}>Распознавание текста с фото</h2>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setShowCameraOverlay(true)}>Открыть камеру</button>
        <button onClick={handlePickFromLibrary}>Выбрать из галереи</button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

      {cameraError && (
        <div style={{ color: 'crimson' }}>
          Доступ к камере не предоставлен: {cameraError}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
        {/* Предпросмотр выбранного/снятого кадра */}
        {imageUrl && (
          <div style={{ position: 'relative', width: '100%', maxWidth: 420 }}>
            <img
              ref={resultImgRef}
              src={imageUrl}
              alt="Выбранное изображение"
              onLoad={(e) => {
                const el = e.currentTarget
                const displayWidth = el.clientWidth
                const displayHeight = el.clientHeight
                setImageDims({
                  naturalWidth: el.naturalWidth,
                  naturalHeight: el.naturalHeight,
                  displayWidth,
                  displayHeight,
                })
                // После установки размеров перерисуем подсветку на основе последних слов
                setTimeout(() => drawHighlights(lastWords), 0)
              }}
              style={{ width: '100%', borderRadius: 8, background: '#f2f2f2', display: 'block' }}
            />
            <canvas
              ref={overlayCanvasRef}
              data-testid="overlay"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                borderRadius: 8,
                pointerEvents: 'none',
                zIndex: 2,
              }}
            />
          </div>
        )}
      </div>

      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {debugEnabled && (
        <div style={{ position: 'fixed', right: 8, bottom: 8, zIndex: 9999, background: 'rgba(0,0,0,0.5)', color: '#fff', padding: '6px 8px', borderRadius: 8, fontSize: 12 }}>
          words: {lastWords.length} · img: {imageDims?.displayWidth ?? 0}×{imageDims?.displayHeight ?? 0}
        </div>
      )}

      {showCameraOverlay && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            width: '100vw',
            height: '100dvh',
            background: '#000',
            zIndex: 1000,
            overflow: 'hidden',
          }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            style={{
              position: 'absolute',
              inset: 0,
              width: '100vw',
              height: '100dvh',
              objectFit: 'cover',
            }}
          />

          {/* Верхняя панель */}
          <div
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              display: 'flex',
              gap: 8,
            }}
          >
            <button
              aria-label="Закрыть камеру"
              onClick={() => setShowCameraOverlay(false)}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                background: 'rgba(0,0,0,0.45)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              ✕
            </button>
          </div>

          {/* Нижняя панель с затвором и кнопкой выбора изображения */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 64px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 20,
              padding: '0 12px',
            }}
          >
            <button
              aria-label="Сделать фото"
              onClick={handleTakePhoto}
              style={{
                width: 76,
                height: 76,
                borderRadius: 38,
                background: '#fff',
                border: '4px solid #e5e5e5',
                boxShadow: '0 0 0 2px rgba(0,0,0,0.2) inset',
              }}
            />
            <button
              onClick={() => {
                handlePickFromLibrary()
              }}
              aria-label="Выбрать изображение"
              style={{
                width: '100%',
                maxWidth: 640,
                height: 48,
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.35)',
                background: 'rgba(0,0,0,0.35)',
                color: '#fff',
              }}
            >
              Выбрать изображение
        </button>
          </div>
        </div>
      )}

      {/* Прогресс OCR (без вывода текста) */}
      {isOcrRunning && (
        <div style={{ marginTop: 8 }}>Распознавание… {Math.round(ocrProgress * 100)}%</div>
      )}
    </div>
  )
}

export default App
