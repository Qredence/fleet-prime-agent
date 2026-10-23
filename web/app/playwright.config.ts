import { defineConfig, devices } from "@playwright/test"
import { hermeticServerEnv, resolveSmokeStateDir } from "./playwright/hermetic-state"

const port = process.env.PLAYWRIGHT_PORT ?? "3000"
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`
// The opt-in real-provider acceptance test needs the developer's own Prime
// credentials, so it keeps the real ~/.prime state; every other run is hermetic.
const hermetic = !process.env.PLAYWRIGHT_BASE_URL && process.env.PRIME_REAL_ACCEPTANCE !== "1"
const serverEnv = hermetic ? hermeticServerEnv(resolveSmokeStateDir()) : undefined
const webServer = process.env.PLAYWRIGHT_BASE_URL
  ? undefined
  : {
      // Agentation is a developer annotation surface that can intentionally block
      // clicks; exclude it from product interaction smoke coverage.
      command: `VITE_FLEET_DISABLE_AGENTATION=1 pnpm exec vite dev --port ${port} --strictPort`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: serverEnv,
    }

/**
 * Playwright smoke for the Fleet Prime web frontend.
 *
 * Runs a single Chromium project against an isolated Vite dev server.
 */
export default defineConfig({
  testDir: "./playwright",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer,
  globalTeardown: hermetic ? "./playwright/global-teardown.ts" : undefined,
})
