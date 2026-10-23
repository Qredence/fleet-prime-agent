import { defineConfig } from "vitest/config"
import viteReact from "@vitejs/plugin-react"

// Dedicated bench config: `vitest run` must never pick up *.bench files, so
// they are matched only by `benchmark.include` here (Vitest 5 runs them in a
// separate benchmark project). Invoked via `pnpm bench`.
export default defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	plugins: [viteReact()],
	test: {
		environment: "happy-dom",
		execArgv: ["--no-experimental-webstorage"],
		globals: true,
		include: [],
		benchmark: {
			include: ["src/**/*.bench.{ts,tsx}"],
		},
	},
})
