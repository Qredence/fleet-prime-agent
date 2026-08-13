import { defineConfig } from "vitest/config"
import viteTsConfigPaths from "vite-tsconfig-paths"
import viteReact from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [viteTsConfigPaths({ projects: ["./tsconfig.json"] }), viteReact()],
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["node_modules/", "playwright/", "**/*.config.{ts,js}"],
    },
  },
})
