import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  use: {
    headless: true,
    // Не сохраняем артефакты, чтобы тесты не занимали память/диск
    video: 'off',
    screenshot: 'off',
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: 'npm run dev -- --host',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 90_000,
  },
});
