// Resolve the env once here, in the main process: the workers and the dev
// server started by `webServer` inherit the result instead of each fetching
// from AWS.
import "varlock/auto-load"
import { defineConfig, devices } from "@playwright/test"
import { ENV } from "varlock/env"

const BASE_URL = ENV.E2E_BASE_URL ?? "http://localhost:3000"

/**
 * Playwright e2e config for the new-payments playground.
 *
 * Tests drive the real checkout UI against the sandbox org configured in
 * `.env.schema` and `.env.local`. A single worker keeps shared sandbox state
 * predictable.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // Show the browser locally; stay headless on CI.
    headless: !!process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
