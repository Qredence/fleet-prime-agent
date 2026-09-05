import { defineConfig } from "vitest/config"
import viteReact from "@vitejs/plugin-react"

// Dedicated bench config: `vitest run` must never pick up *.bench files
// (bench() throws outside bench mode), so they live here instead of the
// main include list. Invoked via `pnpm bench`.
export default defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	plugins: [viteReact()],
	test: {
		environment: "happy-dom",
		globals: true,
		include: ["src/**/*.bench.{ts,tsx}"],
	},
})
