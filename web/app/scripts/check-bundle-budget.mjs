import { existsSync, readFileSync, readdirSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { gzipSync } from "node:zlib"

const assetsDirectory = resolve(import.meta.dirname, "..", "dist", "client", "assets")
const baselineRouteEntryGzipBytes = 1_058_534
const acceptedEagerGraphGzipBytes = 352_192
const maximumEagerGraphGzipBytes = 450 * 1024
const maximumGrowthFactor = 1.05

if (!existsSync(assetsDirectory)) {
  throw new Error("Bundle contract requires a fresh @prime-agent/web production build.")
}

const routeEntries = readdirSync(assetsDirectory).filter((file) => /^routes-.*\.js$/.test(file))
if (routeEntries.length !== 1) {
  throw new Error(`Expected one client route entry, found ${routeEntries.length}.`)
}

const eagerFiles = new Set()
const staticImportPattern = /(?:from\s*|import\s*)["']\.\/([^"']+)["']/g
function visit(file) {
  if (eagerFiles.has(file)) return
  eagerFiles.add(file)
  const source = readFileSync(join(assetsDirectory, file), "utf8")
  for (const match of source.matchAll(staticImportPattern)) visit(match[1])
}
visit(routeEntries[0])

let eagerGzipBytes = 0
for (const file of eagerFiles) {
  eagerGzipBytes += gzipSync(readFileSync(join(assetsDirectory, file))).length
}
const routeEntryGzipBytes = gzipSync(readFileSync(join(assetsDirectory, routeEntries[0]))).length
const reduction = 1 - routeEntryGzipBytes / baselineRouteEntryGzipBytes
const violations = []

if (reduction < 0.3) violations.push(`route entry reduction is ${(reduction * 100).toFixed(1)}%; expected at least 30%`)
if (eagerGzipBytes > maximumEagerGraphGzipBytes) {
  violations.push(`eager graph is ${eagerGzipBytes} bytes gzip; limit is ${maximumEagerGraphGzipBytes}`)
}
if (eagerGzipBytes > acceptedEagerGraphGzipBytes * maximumGrowthFactor) {
  violations.push(`eager graph grew more than 5% from ${acceptedEagerGraphGzipBytes} bytes gzip`)
}

const forbiddenEagerChunks = [
  /openui-renderer/i,
  /settings-dialog/i,
  /markdown-code/i,
  /artifacts-panel/i,
  /resources-panel/i,
  /session-insights-panel/i,
  /workspace-panel/i,
]
for (const file of eagerFiles) {
  if (forbiddenEagerChunks.some((pattern) => pattern.test(basename(file)))) {
    violations.push(`${file} must not be in the welcome route eager graph`)
  }
  const source = readFileSync(join(assetsDirectory, file), "utf8")
  if (/\brecharts\b|createHighlighter|from["']shiki["']/.test(source)) {
    violations.push(`${file} eagerly contains Recharts or Shiki implementation code`)
  }
}

if (violations.length > 0) {
  console.error("Bundle contract failed:")
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exitCode = 1
} else {
  console.log(
    `Bundle contract passed (${eagerFiles.size} eager files, ${eagerGzipBytes} bytes gzip, ${(reduction * 100).toFixed(1)}% route-entry reduction).`,
  )
}
