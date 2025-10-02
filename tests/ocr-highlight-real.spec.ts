import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

test('реальный OCR возвращает боксы и рисует подсветку', async ({ page }) => {
  const base = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:5173'
  await page.goto(base)

  const fileInput = page.locator('input[type="file"]')
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const fixturePath = path.resolve(__dirname, 'fixtures/menu.jpg')
  await fileInput.setInputFiles(fixturePath)

  await page.waitForSelector('img[alt="Выбранное изображение"]')
  const overlay = page.locator('[data-testid="overlay"]')
  await expect(overlay).toBeVisible()

  // Ждём положительный счётчик слов (выставляется в dataset внутри приложения)
  await page.waitForFunction(() => {
    const c = document.querySelector('[data-testid="overlay"]') as HTMLCanvasElement | null
    return !!c && Number(c.dataset.wordsCount || '0') > 0
  }, { timeout: 60_000 })

  // И проверяем непрозрачные пиксели (подсветка реально нарисована)
  const countHandle = await page.waitForFunction(() => {
    const c = document.querySelector('[data-testid="overlay"]') as HTMLCanvasElement | null
    if (!c || !c.width || !c.height) return 0
    const ctx = c.getContext('2d'); if (!ctx) return 0
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let nonTransparent = 0
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) nonTransparent++
    // Дополнительно убеждаемся, что wordsCount в dataset > 0
    const words = Number(c.dataset.wordsCount || '0')
    return words > 0 ? nonTransparent : 0
  }, { timeout: 60_000 })

  const count = await countHandle.jsonValue() as number
  expect(count).toBeGreaterThan(200)
})


