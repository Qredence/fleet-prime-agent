import { resolve } from "node:path"
import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import viteTsConfigPaths from "vite-tsconfig-paths"
import tailwindcss from "@tailwindcss/vite"

const webRoot = resolve(import.meta.dirname)

const config = defineConfig({
  envDir: webRoot,
  server: {
    port: 3000,
    strictPort: false,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/.env", "**/.env.local"],
    },
  },
  plugins: [
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
