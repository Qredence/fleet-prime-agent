import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const webRoot = resolve(import.meta.dirname)
const fleetPackageJson = JSON.parse(
  readFileSync(resolve(webRoot, "..", "..", "packages", "fleet-web", "package.json"), "utf8"),
) as { version?: unknown }
const fleetVersion = typeof fleetPackageJson.version === "string" ? fleetPackageJson.version : "dev"

const config = defineConfig({
  envDir: webRoot,
  define: {
    __FLEET_VERSION__: JSON.stringify(fleetVersion),
  },
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
