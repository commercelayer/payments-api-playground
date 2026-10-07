import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Playwright e2e config for the new-payments playground.
 *
 * Tests drive the real checkout UI against the sandbox org configured in
 * `.env.local` — the `webServer` below boots `next dev`, which loads `.env.local`
 * itself, so no extra env wiring is needed here. A single worker keeps shared
 * sandbox state predictable.
 */
export default defineConfig({
	testDir: "./tests/e2e",
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
});
