import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig, loadEnv } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const webRoot = resolve(import.meta.dirname)
const fleetPackageJson = JSON.parse(
  readFileSync(resolve(webRoot, "..", "..", "packages", "fleet-web", "package.json"), "utf8"),
) as { version?: unknown }
const fleetVersion = typeof fleetPackageJson.version === "string" ? fleetPackageJson.version : "dev"

const config = defineConfig(({ mode }) => {
  // The server reads these keys from process.env only. Vite's envDir feeds
  // import.meta.env but not process.env, so `web/app/.env` never reached the
  // server handlers. Promote just these server-side keys; prefixing one with
  // VITE_ would publish it to the browser bundle, so they stay unprefixed.
  // THESYS_API_KEY is OpenUI's documented name. FLEET_DASHBOARD_MODEL pins the
  // Cloud builder. A shell export still wins over the file.
  const fileEnv = loadEnv(mode, webRoot, "")
  for (const name of ["THESYS_API_KEY", "FLEET_DASHBOARD_MODEL"] as const) {
    if (!process.env[name] && fileEnv[name]) process.env[name] = fileEnv[name]
  }

  return {
    envDir: webRoot,
    define: {
      __FLEET_VERSION__: JSON.stringify(fleetVersion),
    },
    resolve: {
      tsconfigPaths: true,
    },
    optimizeDeps: {
      include: [
        "@tanstack/react-router",
        "@tanstack/router-core",
        "@tanstack/history",
      ],
    },
    server: {
      port: 3000,
      strictPort: false,
      host: "127.0.0.1",
      allowedHosts: [],
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
    plugins: [tailwindcss(), tanstackStart(), viteReact({ compiler: true })],
  }
})

export default config
