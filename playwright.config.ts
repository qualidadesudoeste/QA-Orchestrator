import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'
import path from 'path'

// Carrega o .env da raiz do projeto antes de qualquer coisa
dotenv.config({ path: path.resolve(__dirname, '.env') })

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : 1,

  reporter: [
    ['html', { outputFolder: 'artifacts/reports/html', open: 'never' }],
    ['allure-playwright', { outputFolder: 'artifacts/allure-results', detail: true }],
    ['json', { outputFile: 'artifacts/reports/results.json' }],
    ['list'],
  ],

  use: {
    baseURL: process.env.BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'on-first-retry',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },

  projects: [
    // ── SIGP ──────────────────────────────────────────────────
    {
      name: 'sigp-setup',
      testMatch: /sigp\/setup\/auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'sigp-functional',
      testDir: './tests/sigp/functional',
      dependencies: ['sigp-setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/sigp.json',
      },
    },
    {
      name: 'sigp-security',
      testDir: './tests/sigp/security',
      dependencies: ['sigp-setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/sigp.json',
      },
    },
    {
      name: 'sigp-api',
      testDir: './tests/sigp/api',
    },

    // ── Outros sistemas ───────────────────────────────────────
    // Convenção: cada sistema alvo ganha sua própria pasta tests/<sistema>/
    // com subpastas por categoria (functional, api, security, ...) e seus
    // próprios projetos aqui, no mesmo molde dos projetos sigp-* acima.
  ],

  outputDir: 'artifacts/evidence/test-results',
})
