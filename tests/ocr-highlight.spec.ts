import { test, expect } from '@playwright/test'

test('подсветка слов появляется на overlay canvas (mock)', async ({ page }) => {
  const base = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:5173'
  await page.goto(base + '/?mockOcr=1')

  // Input существует на странице
  const fileInput = page.locator('input[type="file"]')

  // Подставляем минимальный PNG (1x1) — изображение не важно в режиме mock
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAukB9Xz3mGQAAAAASUVORK5CYII='
  const buffer = Buffer.from(pngBase64, 'base64')
  await fileInput.setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer })

  // Ждём появления картинки и overlay
  await page.waitForSelector('img[alt="Выбранное изображение"]')
  const overlay = page.locator('[data-testid="overlay"]')
  await expect(overlay).toBeVisible()

  // Ждём, пока на холсте появятся непрозрачные пиксели (подсветка)
  const countHandle = await page.waitForFunction(() => {
    const c = document.querySelector('[data-testid="overlay"]') as HTMLCanvasElement | null
    if (!c || !c.width || !c.height) return 0
    const ctx = c.getContext('2d'); if (!ctx) return 0
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    let nonTransparent = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) nonTransparent++
    }
    return nonTransparent
  }, { timeout: 45_000 })

  const count = await countHandle.jsonValue() as number
  expect(count).toBeGreaterThan(200)
})


