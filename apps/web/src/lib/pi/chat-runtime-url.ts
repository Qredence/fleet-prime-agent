const RUNTIME_API_PREFIXES = [
  "/api/chat",
  "/api/chat/abort",
  "/api/chat/question",
  "/api/chat/resume",
  "/api/chat/new",
  "/api/chat/sessions",
  "/api/chat/session",
  "/api/chat/runs",
  "/api/chat/run",
] as const

export function resolveChatRuntimeBaseUrl() {
  const fromVite = import.meta.env.VITE_FLEET_PI_CHAT_RUNTIME_URL
  if (typeof fromVite === "string" && fromVite.trim()) {
    return fromVite.trim().replace(/\/$/, "")
  }
  return ""
}

export function isChatRuntimePath(path: string) {
  return RUNTIME_API_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}?`)
  )
}

export function resolveChatApiUrl(path: string) {
  const base = resolveChatRuntimeBaseUrl()
  if (!base) {
    return path
  }

  const [pathname] = path.split("?")
  if (!isChatRuntimePath(pathname)) {
    return path
  }

  return `${base}${path}`
}
