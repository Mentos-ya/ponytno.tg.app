import { useEffect, useRef, useState } from 'react'
import WebApp from '@twa-dev/sdk'
import Tesseract from 'tesseract.js'
import './App.css'

type OcrWord = { 
  bbox: { x0: number; y0: number; x1: number; y1: number }
  text: string
  fontSize: number
  category?: TextCategory // Опциональная категория от YandexGPT
}
type OcrResult = { text: string; words: OcrWord[] }
type TextCategory = 'title' | 'description' | 'price' | 'price_modifier'
type OcrProgressCallback = (progress: number) => void
type OcrProvider = {
  recognize: (imageUrl: string, onProgress?: OcrProgressCallback) => Promise<OcrResult>
}

// Фильтруем служебные ошибки из консоли
const originalConsoleError = console.error
const originalConsoleWarn = console.warn
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
const urlParams = new URLSearchParams(window.location.search)
// Debug включен по умолчанию в development, можно отключить с ?debug=0
const isDebugParam = isDevelopment ? !urlParams.has('debug') || urlParams.get('debug') !== '0' : urlParams.has('debug')
// В превью/проде шлём на /api/log того же хоста; в dev — на локальный сервер
const logEndpoint = isDevelopment ? 'http://localhost:3030/log' : '/api/log'

// Переопределяем console.error для фильтрации служебных ошибок
console.error = (...args: any[]) => {
  const message = args.map(a => String(a)).join(' ')
  // Фильтруем ошибки BrowserAutomation
  if (message.includes('postMessage') || 
      message.includes('register-iframe') ||
      message.includes('DOMWindow') ||
      message.includes('vscode-file://') ||
      message.includes('MCP server')) {
    return // Игнорируем эти ошибки
  }
  originalConsoleError(...args)
}

// Переопределяем console.warn для фильтрации служебных предупреждений
console.warn = (...args: any[]) => {
  const message = args.map(a => String(a)).join(' ')
  // Фильтруем предупреждения BrowserAutomation
  if (message.includes('postMessage') || 
      message.includes('register-iframe') ||
      message.includes('DOMWindow') ||
      message.includes('vscode-file://') ||
      message.includes('MCP server')) {
    return // Игнорируем эти предупреждения
  }
  originalConsoleWarn(...args)
}

// Подавляем служебные ошибки BrowserAutomation
window.addEventListener('error', (event) => {
  const errorMessage = event.message || ''
  if (errorMessage.includes('postMessage') || 
      errorMessage.includes('register-iframe') ||
      errorMessage.includes('DOMWindow') ||
      errorMessage.includes('vscode-file://')) {
    event.preventDefault()
    event.stopPropagation()
    return false
  }
}, true)

// Подавляем необработанные Promise rejection от BrowserAutomation
window.addEventListener('unhandledrejection', (event) => {
  const reason = String(event.reason || '')
  if (reason.includes('postMessage') || 
      reason.includes('register-iframe') ||
      reason.includes('vscode-file://') ||
      reason.includes('MCP')) {
    event.preventDefault()
    return false
  }
})

// Простая функция для отправки логов без перехвата консоли
const sendToLogServer = (level: string, message: string, data?: any) => {
  // В dev шлём всегда; в превью/проде — только при ?debug, чтобы не шуметь
  if (!isDevelopment && !isDebugParam) return
  
  const payload: any = {
    message: `[${level}] ${message}`,
    timestamp: new Date().toLocaleTimeString('ru-RU')
  }
  if (data !== undefined) {
    payload.data = data
  }
  if (!isDevelopment) {
    payload.url = window.location.href
    payload.userAgent = navigator.userAgent
    payload.level = level
  }
  fetch(logEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {})
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

// ❌ ЛОКАЛЬНАЯ КЛАССИФИКАЦИЯ УДАЛЕНА
// Теперь используем ТОЛЬКО AI-классификацию от YandexGPT
// Fallback для других методов (Vision, Tesseract): все слова = 'description'

// Цвета для категорий (яркие цвета с хорошей видимостью текста)
function getCategoryColor(category: TextCategory): string {
  switch (category) {
    case 'title': 
      return 'rgba(255, 100, 100, 0.4)' // ярко-розовый (title)
    case 'description': 
      return 'rgba(255, 200, 50, 0.4)' // ярко-жёлтый (description)
    case 'price': 
      return 'rgba(100, 255, 100, 0.4)' // ярко-зелёный (price)
    case 'price_modifier':
      return 'rgba(100, 200, 255, 0.4)' // голубой (уточнение цены: DOUBLE, TRIPLE)
    default:
      console.warn('Unknown category:', category)
      return 'rgba(255, 200, 50, 0.4)' // default = description (жёлтый)
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
  const [menuItems, setMenuItems] = useState<Array<{
    priceModifier: OcrWord[]
    title: OcrWord[]
    price: OcrWord[]
    description: OcrWord[]
  }>>([])
  const [selectedDish, setSelectedDish] = useState<{
    title: string
    priceModifier?: string
    prices: string[]
    description: string
  } | null>(null)
  // Debug и test включены по умолчанию в development
  const [debugEnabled] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return isDevelopment ? !params.has('debug') || params.get('debug') !== '0' : params.has('debug')
  })
  const [testEnabled] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return isDevelopment ? !params.has('test') || params.get('test') !== '0' : params.has('test')
  })
  const [showCameraOverlay, setShowCameraOverlay] = useState(false)
  const [isDrawing, setIsDrawing] = useState(false)

  const addLog = (message: string, data?: any) => {
    console.log(message, data !== undefined ? data : '')
    // Отправляем на лог-сервер напрямую
    sendToLogServer('LOG', message, data)
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

  // Функция для использования YandexGPT API (ПРИОРИТЕТ 1)
  const analyzeWithYandexGPT = async (imageUrl: string): Promise<OcrResult> => {
    try {
      addLog('🤖 Анализируем изображение через YandexGPT API...')
      
      const response = await fetch('/api/analyze-image-gpt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageData: imageUrl,
          mimeType: 'image/jpeg'
        })
      })

      if (!response.ok) {
        throw new Error(`YandexGPT API error: ${response.status}`)
      }

      const data = await response.json()
      
      if (!data.success) {
        throw new Error(data.message || 'YandexGPT API failed')
      }

      addLog('✅ YandexGPT успешно обработал изображение')
      addLog('📝 Найденный текст:', data.text.substring(0, 100) + '...')
      addLog('📊 Количество слов:', data.totalWords)
      addLog('🎯 Источник:', data.source)

      // Конвертируем результат в формат OcrResult
      // YandexGPT уже возвращает слова с категориями!
      const words: OcrWord[] = data.words.map((word: any) => ({
        text: word.text,
        bbox: word.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
        fontSize: word.fontSize || 14,
        category: word.category // Категория уже определена YandexGPT!
      }))

      return {
        text: data.text,
        words: words
      }

    } catch (error) {
      addLog('❌ Ошибка YandexGPT API:', error)
      throw error
    }
  }

  // Функция для использования Yandex Vision API (ПРИОРИТЕТ 2 - fallback)
  const analyzeWithYandexVision = async (imageUrl: string): Promise<OcrResult> => {
    try {
      addLog('🔍 Анализируем изображение через Yandex Vision API (fallback)...')
      
      const response = await fetch('/api/analyze-image-vision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageData: imageUrl,
          mimeType: 'image/jpeg'
        })
      })

      if (!response.ok) {
        throw new Error(`Vision API error: ${response.status}`)
      }

      const data = await response.json()
      
      if (!data.success) {
        throw new Error(data.message || 'Vision API failed')
      }

      addLog('✅ Yandex Vision API успешно обработал изображение')
      addLog('📝 Найденный текст:', data.text.substring(0, 100) + '...')
      addLog('📊 Количество слов:', data.totalWords)

      // Конвертируем результат в формат OcrResult
      const words: OcrWord[] = data.words.map((word: any) => ({
        text: word.text,
        bbox: word.bbox, // Используем реальные координаты от Yandex Vision API
        fontSize: Math.abs(word.bbox.y1 - word.bbox.y0) // Высота бокса как размер шрифта
      }))

      return {
        text: data.text,
        words: words
      }

    } catch (error) {
      addLog('❌ Ошибка Yandex Vision API:', error)
      throw error
    }
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
        // YandexGPT включен по умолчанию в development, можно отключить с ?yandexGPT=0
        const useYandexGPT = isDevelopment ? !urlParams.has('yandexGPT') || urlParams.get('yandexGPT') !== '0' : urlParams.has('yandexGPT')
        // Yandex Vision как fallback, можно отключить с ?yandexVision=0
        const useYandexVision = isDevelopment ? !urlParams.has('yandexVision') || urlParams.get('yandexVision') !== '0' : urlParams.has('yandexVision')
        
        if (useYandexGPT) {
          try {
            addLog('🤖 Используем YandexGPT API (приоритет 1)')
            const result = await analyzeWithYandexGPT(imageUrl)
            addLog('Распознанный текст', result.text.substring(0, 100) + '...')
            addLog('Количество распознанных слов', result.words.length)
            
            // YandexGPT уже вернул слова с категориями!
            const classified = result.words.map(w => ({
              text: w.text,
              category: w.category || 'description' // Категория от YandexGPT, fallback = description
            }))
            addLog('Классифицированные слова (от YandexGPT):', classified)
            setLastWords(result.words)
            addLog('Слова сохранены, ждём imageDims для отрисовки')
            return
          } catch (gptError) {
            addLog('⚠️ YandexGPT API не сработал, пробуем Yandex Vision API (fallback)...')
            console.error('YandexGPT error:', gptError)
            
            // Fallback на Yandex Vision API
            if (useYandexVision) {
              addLog('🔍 Используем Yandex Vision API (fallback)')
              const result = await analyzeWithYandexVision(imageUrl)
              addLog('Распознанный текст', result.text.substring(0, 100) + '...')
              addLog('Количество распознанных слов', result.words.length)
              const classified = result.words.map(w => ({
                text: w.text,
                category: w.category || 'description' // Без YandexGPT все = description
              }))
              addLog('Классифицированные слова (без GPT - все description):', classified)
              setLastWords(result.words)
              addLog('Слова сохранены, ждём imageDims для отрисовки')
              return
            }
          }
        } else if (useYandexVision) {
          addLog('🔍 Используем Yandex Vision API')
          const result = await analyzeWithYandexVision(imageUrl)
          addLog('Распознанный текст', result.text.substring(0, 100) + '...')
          addLog('Количество распознанных слов', result.words.length)
          const classified = result.words.map(w => ({
            text: w.text,
            category: w.category || 'description' // Без YandexGPT все = description
          }))
          addLog('Классифицированные слова (без GPT):', classified)
          setLastWords(result.words)
          addLog('Слова сохранены, ждём imageDims для отрисовки')
          return
        }
        
        const provider = useMock ? mockProvider : tesseractProvider
        addLog('Провайдер выбран', useMock ? 'mock' : 'tesseract')
        // Предобработка для повышения качества OCR
        const ocrSrc = useMock ? imageUrl : await preprocessForOcr(imageUrl)
        addLog('Предобработка завершена, запускаем recognize')
        const result = await provider.recognize(ocrSrc, (p) => setOcrProgress(p))
        addLog('Распознанный текст', result.text.substring(0, 100) + '...')
        addLog('Количество распознанных слов', result.words.length)
        // Без YandexGPT все слова = description
        const classified = result.words.map(w => ({
          text: w.text,
          category: w.category || 'description' // Tesseract без GPT
        }))
        addLog('Классифицированные слова (Tesseract без GPT):', classified)
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
    
    // Защита от повторных вызовов
    if (isDrawing) {
      addLog('drawHighlights уже выполняется, пропускаем')
      return
    }
    setIsDrawing(true)
    
    const img = resultImgRef.current
    const canvas = overlayCanvasRef.current
    addLog('Проверка элементов', { 
      hasImg: !!img, 
      hasCanvas: !!canvas, 
      hasImageDims: !!imageDims 
    })
    if (!img || !canvas || !imageDims) {
      addLog('ВЫХОД: не все элементы готовы')
      setIsDrawing(false)
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
        // Используем ТОЛЬКО категорию от YandexGPT, fallback = description
        const category = w.category || 'description'
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
      
      // ========== НОВАЯ ФУНКЦИЯ: Группировка слов в позиции меню ==========
      interface MenuItem {
        priceModifier: WordRect[]
        title: WordRect[]
        price: WordRect[]
        description: WordRect[]
      }
      
      const groupMenuItems = (allWords: WordRect[]): MenuItem[] => {
        const items: MenuItem[] = []
        let currentItem: MenuItem | null = null
        
        // Сортируем все слова по Y, затем по X (читаем как текст: сверху-вниз, слева-направо)
        const sortedWords = [...allWords].sort((a, b) => {
          const yDiff = a.y - b.y
          if (Math.abs(yDiff) < 10) return a.x - b.x // Если на одной строке, сортируем по X
          return yDiff
        })
        
        for (const word of sortedWords) {
          // Начало новой позиции: price_modifier или title (если нет текущей позиции или встретили новый заголовок)
          if (word.category === 'price_modifier' || 
              (word.category === 'title' && currentItem && currentItem.description.length > 0)) {
            // Сохраняем предыдущую позицию, если она была
            if (currentItem) items.push(currentItem)
            // Начинаем новую позицию
            currentItem = { priceModifier: [], title: [], price: [], description: [] }
          }
          
          // Если это первое слово и это title - начинаем позицию
          if (!currentItem && word.category === 'title') {
            currentItem = { priceModifier: [], title: [], price: [], description: [] }
          }
          
          // Если есть текущая позиция - добавляем слово в соответствующую категорию
          if (currentItem) {
            if (word.category === 'price_modifier') {
              currentItem.priceModifier.push(word)
            } else if (word.category === 'title') {
              currentItem.title.push(word)
            } else if (word.category === 'price') {
              currentItem.price.push(word)
            } else if (word.category === 'description') {
              currentItem.description.push(word)
            }
          }
        }
        
        // Добавляем последнюю позицию
        if (currentItem) items.push(currentItem)
        
        // Фильтруем пустые или неполные позиции (должен быть хотя бы title)
        return items.filter(item => item.title.length > 0)
      }
      
      const groupedItems = groupMenuItems(wordRects)
      
      // Преобразуем WordRect обратно в OcrWord для сохранения в состояние
      const menuItemsForState = groupedItems.map(item => ({
        priceModifier: item.priceModifier.map(wr => words[wr.originalIndex]),
        title: item.title.map(wr => words[wr.originalIndex]),
        price: item.price.map(wr => words[wr.originalIndex]),
        description: item.description.map(wr => words[wr.originalIndex])
      }))
      
      // Сохраняем в состояние для использования в handleCanvasClick
      setMenuItems(menuItemsForState)
      
      addLog(`📦 Найдено позиций меню: ${groupedItems.length}`, groupedItems.map((item, idx) => ({
        index: idx + 1,
        priceModifier: item.priceModifier.map(w => w.text).join(' ') || 'нет',
        title: item.title.map(w => w.text).join(' '),
        price: item.price.map(w => w.text).join(' ') || 'нет',
        description: item.description.map(w => w.text).join(' ').slice(0, 50) + '...'
      })))
      
      // ========== Рисуем серые рамки вокруг каждой позиции меню ==========
      ctx.strokeStyle = 'rgba(128, 128, 128, 0.8)' // серый цвет
      ctx.lineWidth = 2
      
      for (const item of groupedItems) {
        // Собираем все слова позиции
        const allItemWords = [
          ...item.priceModifier,
          ...item.title,
          ...item.price,
          ...item.description
        ]
        
        if (allItemWords.length === 0) continue
        
        // Находим границы позиции
        const minX = Math.min(...allItemWords.map(w => w.x))
        const minY = Math.min(...allItemWords.map(w => w.y))
        const maxX = Math.max(...allItemWords.map(w => w.x + w.width))
        const maxY = Math.max(...allItemWords.map(w => w.y + w.height))
        
        // Добавляем отступы
        const framePadding = 8
        const frameX = Math.max(0, minX - framePadding)
        const frameY = Math.max(0, minY - framePadding)
        const frameWidth = maxX - minX + framePadding * 2
        const frameHeight = maxY - minY + framePadding * 2
        
        // Рисуем рамку (без заливки)
        ctx.strokeRect(frameX, frameY, frameWidth, frameHeight)
      }
      
      // Шаг 3: Для каждой строки объединяем description-блоки и рисуем
      const padding = 1 // минимальный отступ
      for (const line of lines) {
        // Находим минимальный Y и максимальный Y + height в строке
        const minY = Math.min(...line.map(r => r.y))
        const maxY = Math.max(...line.map(r => r.y + r.height))
        const lineHeight = maxY - minY
        
        // Сортируем слова в строке по X (слева направо)
        const sortedLine = [...line].sort((a, b) => a.x - b.x)
        
        // Группируем последовательные слова одной категории в монолитные блоки
        const blocks: { category: TextCategory, words: WordRect[] }[] = []
        let currentBlock: { category: TextCategory, words: WordRect[] } | null = null
        
        for (const rect of sortedLine) {
          const shouldMerge = rect.category === 'description' || rect.category === 'title' || rect.category === 'price_modifier'
          if (currentBlock && currentBlock.category === rect.category && shouldMerge) {
            // Продолжаем текущий блок той же категории (description, title, price_modifier)
            currentBlock.words.push(rect)
          } else {
            // Начинаем новый блок
            if (currentBlock) blocks.push(currentBlock)
            currentBlock = { category: rect.category, words: [rect] }
          }
        }
        if (currentBlock) blocks.push(currentBlock)
        
        // Рисуем блоки
        for (const block of blocks) {
          const shouldDrawAsBlock = block.category === 'description' || block.category === 'title' || block.category === 'price_modifier'
          if (shouldDrawAsBlock && block.words.length > 0) {
            // Для description, title и price_modifier рисуем ОДИН монолитный прямоугольник
            const firstWord = block.words[0]
            const lastWord = block.words[block.words.length - 1]
            const x = Math.max(0, Math.round(firstWord.x - padding))
            const y = Math.max(0, Math.round(minY - padding))
            const width = Math.max(1, Math.round((lastWord.x + lastWord.width - firstWord.x) + padding * 2))
            const height = Math.max(1, Math.round(lineHeight + padding * 2))
            
            ctx.fillStyle = getCategoryColor(block.category)
            ctx.fillRect(x, y, width, height)
          } else {
            // Для price рисуем каждое слово отдельно
            for (const rect of block.words) {
              const x = Math.max(0, Math.round(rect.x - padding))
              const y = Math.max(0, Math.round(minY - padding))
              const width = Math.max(1, Math.round(rect.width + padding * 2))
              const height = Math.max(1, Math.round(lineHeight + padding * 2))
              
              ctx.fillStyle = getCategoryColor(rect.category)
              ctx.fillRect(x, y, width, height)
            }
          }
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
    
    // Сбрасываем флаг после завершения отрисовки
    setIsDrawing(false)
  }

  // Обработчик клика на canvas - использует сохранённые menuItems (серые рамки)
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!imageDims || lastWords.length === 0 || menuItems.length === 0) return

    const canvas = overlayCanvasRef.current
    if (!canvas) return

    // Получаем координаты клика относительно canvas
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY

    // Ищем слово под кликом (только title)
    const clickedWord = lastWords.find(word => {
      if (word.category !== 'title') return false
      
      const { displayWidth, displayHeight } = imageDims
      const isNormalized = word.bbox.x1 <= 1 && word.bbox.y1 <= 1
      
      let wordX, wordY, wordWidth, wordHeight
      if (isNormalized) {
        wordX = word.bbox.x0 * displayWidth * 2 // *2 для DPR
        wordY = word.bbox.y0 * displayHeight * 2
        wordWidth = (word.bbox.x1 - word.bbox.x0) * displayWidth * 2
        wordHeight = (word.bbox.y1 - word.bbox.y0) * displayHeight * 2
      } else {
        const scaleFactorX = displayWidth / imageDims.naturalWidth
        const scaleFactorY = displayHeight / imageDims.naturalHeight
        wordX = word.bbox.x0 * scaleFactorX * 2
        wordY = word.bbox.y0 * scaleFactorY * 2
        wordWidth = (word.bbox.x1 - word.bbox.x0) * scaleFactorX * 2
        wordHeight = (word.bbox.y1 - word.bbox.y0) * scaleFactorY * 2
      }

      return x >= wordX && x <= wordX + wordWidth && y >= wordY && y <= wordY + wordHeight
    })

    if (clickedWord) {
      // Находим позицию меню, к которой принадлежит кликнутое слово
      const matchedItem = menuItems.find(item => 
        item.title.some(word => 
          word.text === clickedWord.text && 
          word.bbox.x0 === clickedWord.bbox.x0 && 
          word.bbox.y0 === clickedWord.bbox.y0
        )
      )

      if (matchedItem) {
        // Формируем данные для модального окна из найденной позиции (серой рамки)
        const dishInfo = {
          title: matchedItem.title.map(w => w.text).join(' '),
          priceModifier: matchedItem.priceModifier.length > 0 
            ? matchedItem.priceModifier.map(w => w.text).join(' ') 
            : undefined,
          prices: matchedItem.price.map(w => w.text),
          description: matchedItem.description.map(w => w.text).join(' ')
        }
        
        setSelectedDish(dishInfo)
        addLog('📦 Клик на позицию меню (из серой рамки):', dishInfo)
      }
    }
  }

  // Перерисовывать подсветку, когда меняются размеры или слова
  useEffect(() => {
    addLog('useEffect: imageDims или lastWords изменились', {
      hasImageDims: !!imageDims,
      wordsCount: lastWords.length
    })
    if (imageDims && lastWords.length > 0) {
      addLog('Условия выполнены, вызываем drawHighlights')
      // Добавляем небольшую задержку, чтобы избежать слишком частых вызовов
      const timeoutId = setTimeout(() => {
        drawHighlights(lastWords)
      }, 10)
      
      return () => clearTimeout(timeoutId)
    } else {
      addLog('Условия НЕ выполнены', {
        needImageDims: !imageDims,
        needWords: lastWords.length === 0
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageDims, lastWords])

  // ВРЕМЕННО ОТКЛЮЧАЕМ ResizeObserver для устранения бесконечных циклов
  // useEffect(() => {
  //   const img = resultImgRef.current
  //   if (!img) return
  //   const ro = new ResizeObserver(() => {
  //     const displayWidth = img.clientWidth
  //     const displayHeight = img.clientHeight
  //     
  //     // Проверяем, действительно ли размеры изменились
  //     setImageDims(prev => {
  //       if (prev && 
  //           prev.displayWidth === displayWidth && 
  //           prev.displayHeight === displayHeight) {
  //         return prev // Не обновляем, если размеры не изменились
  //       }
  //       
  //       return {
  //         naturalWidth: img.naturalWidth || displayWidth,
  //         naturalHeight: img.naturalHeight || displayHeight,
  //         displayWidth,
  //         displayHeight,
  //       }
  //     })
  //   })
  //   ro.observe(img)
  //   return () => ro.disconnect()
  // }, [imageUrl])

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
                // Размеры установлены, useEffect сам перерисует подсветку
              }}
              style={{ width: '100%', borderRadius: 8, background: '#f2f2f2', display: 'block' }}
            />
            <canvas
              ref={overlayCanvasRef}
              data-testid="overlay"
              onClick={handleCanvasClick}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                borderRadius: 8,
                pointerEvents: 'auto',
                cursor: 'pointer',
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

      {/* Модальное окно с информацией о блюде */}
      {selectedDish && (
        <div
          onClick={() => setSelectedDish(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#fff',
              borderRadius: 12,
              padding: 16,
              width: '280px',
              maxHeight: '520px',
              overflowY: 'auto',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
              aspectRatio: '9 / 16',
            }}
          >
            {/* Заголовок блюда */}
            <h2
              style={{
                margin: '0 0 12px 0',
                fontSize: 18,
                fontWeight: 'bold',
                color: '#FF6464',
                lineHeight: 1.3,
              }}
            >
              {selectedDish.title}
            </h2>

            {/* Уточнение цены (если есть) */}
            {selectedDish.priceModifier && (
              <div
                style={{
                  marginBottom: 8,
                  padding: '6px 10px',
                  backgroundColor: 'rgba(100, 200, 255, 0.2)',
                  borderRadius: 6,
                  fontSize: 12,
                  color: '#0088CC',
                  fontWeight: '600',
                }}
              >
                Варианты: {selectedDish.priceModifier}
              </div>
            )}

            {/* Цены */}
            {selectedDish.prices.length > 0 && (
              <div
                style={{
                  marginBottom: 12,
                  padding: '10px 12px',
                  backgroundColor: 'rgba(100, 255, 100, 0.2)',
                  borderRadius: 6,
                }}
              >
                <div style={{ fontSize: 11, color: '#666', marginBottom: 3 }}>Цена:</div>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#22BB22' }}>
                  {selectedDish.prices.join(' / ')} ₽
                </div>
              </div>
            )}

            {/* Описание */}
            {selectedDish.description && (
              <div>
                <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>Описание:</div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    lineHeight: 1.4,
                    color: '#333',
                  }}
                >
                  {selectedDish.description}
                </p>
              </div>
            )}

            {/* Кнопка закрытия */}
            <button
              onClick={() => setSelectedDish(null)}
              style={{
                marginTop: 16,
                width: '100%',
                padding: 10,
                backgroundColor: '#007AFF',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
