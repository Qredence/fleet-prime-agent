import { resolve } from "node:path"
import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const webRoot = resolve(import.meta.dirname)

const config = defineConfig({
  envDir: webRoot,
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: 3000,
    strictPort: false,
    host: "127.0.0.1",
    fs: {
      allow: [
        webRoot,
        resolve(webRoot, ".."),
        resolve(webRoot, "../../packages"),
        // pnpm store lives at the repo root since the workspace unification.
        resolve(webRoot, "../../node_modules"),
      ],
    },
    watch: {
      ignored: ["**/.env", "**/.env.local"],
    },
  },
  ssr: {
    external: [
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-tui",
      "prime-agent",
    ],
  },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})

export default config
