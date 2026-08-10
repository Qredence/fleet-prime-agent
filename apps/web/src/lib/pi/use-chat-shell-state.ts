import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  toModelOption,
  toModelSelection,
} from "@prime-agent/web-design/lib/pi/chat-helpers"
import {
  applyThemePreference,
  clampResourceCanvasWidth,
  getResourceCanvasInitialWidth,
  readStoredResourceCanvasWidth,
  readStoredThemePreference,
  storeResourceCanvasWidth,
  storeThemePreference,
} from "@prime-agent/web-design/lib/canvas-utils"
import { startHorizontalResize } from "@prime-agent/web-design/lib/horizontal-resize"
import { resolveWorkspacePanelTarget } from "@prime-agent/web-design/lib/workspace-path-nav"
import { useChatStorage } from "./use-chat-storage"
import type { PointerEvent as ReactPointerEvent } from "react"
import type {
  ChatModelsResponse,
  ChatSessionMetadata,
} from "@prime-agent/web-protocol/chat-protocol"
import type {
  RightPanel,
  ThemePreference,
} from "@prime-agent/web-design/lib/canvas-utils"

export function useChatShellState(modelsData: ChatModelsResponse | undefined) {
  const {
    sessionMetadata: storedSessionMetadata,
    setSessionMetadata: setStoredSessionMetadata,
  } = useChatStorage()

  const models = useMemo(
    () => modelsData?.models.map(toModelOption) ?? [],
    [modelsData]
  )
  const [modelKey, setModelKey] = useState<string | undefined>()
  const [rightPanel, setRightPanelState] = useState<RightPanel>(null)
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<
    string | null
  >(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    readStoredThemePreference()
  )
  const [resourceCanvasWidth, setResourceCanvasWidth] = useState(() =>
    readStoredResourceCanvasWidth()
  )

  useEffect(() => {
    if (models.length === 0) return

    const preferredKey = modelsData?.selectedModelKey ?? models[0].id

    if (!modelKey) {
      setModelKey(preferredKey)
      return
    }

    const selected = models.find((model) => model.id === modelKey)
    if (!selected || selected.available === false) {
      setModelKey(preferredKey)
    }
  }, [models, modelKey, modelsData])

  useEffect(() => {
    applyThemePreference(themePreference)

    if (themePreference !== "system") return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = () => applyThemePreference("system")
    media.addEventListener("change", handleChange)
    return () => media.removeEventListener("change", handleChange)
  }, [themePreference])

  const prevRightPanelRef = useRef<RightPanel>(null)

  useEffect(() => {
    const prevRightPanel = prevRightPanelRef.current
    prevRightPanelRef.current = rightPanel

    if (!rightPanel || prevRightPanel !== null) return

    const initialWidth = getResourceCanvasInitialWidth()
    setResourceCanvasWidth(initialWidth)
    storeResourceCanvasWidth(initialWidth)
  }, [rightPanel])

  useEffect(() => {
    if (rightPanel !== null) return
    setSelectedWorkspacePath(null)
  }, [rightPanel])

  useEffect(() => {
    if (!rightPanel) return

    const handleViewportResize = () => {
      setResourceCanvasWidth((currentWidth) => {
        const nextWidth = clampResourceCanvasWidth(currentWidth)
        storeResourceCanvasWidth(nextWidth)
        return nextWidth
      })
    }

    window.addEventListener("resize", handleViewportResize)
    return () => {
      window.removeEventListener("resize", handleViewportResize)
    }
  }, [rightPanel])

  const handleThemePreferenceChange = useCallback(
    (preference: ThemePreference) => {
      setThemePreference(preference)
      storeThemePreference(preference)
      applyThemePreference(preference)
    },
    []
  )

  const handleResourceCanvasResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const startWidth = resourceCanvasWidth

      startHorizontalResize({
        event,
        startWidth,
        getNextWidth: (clientX, startX, width) =>
          clampResourceCanvasWidth(width - (clientX - startX)),
        onWidthChange: (nextWidth) => {
          setResourceCanvasWidth(nextWidth)
          storeResourceCanvasWidth(nextWidth)
        },
      })
    },
    [resourceCanvasWidth]
  )

  const setRightPanel = useCallback((panel: RightPanel) => {
    setRightPanelState(panel)

    if (panel === null) return

    setSelectedWorkspacePath((current) => {
      if (!current) return current
      const target = resolveWorkspacePanelTarget(current)
      if (!target || target.panel === panel) return current
      return null
    })
  }, [])

  const openWorkspacePath = useCallback(
    (rawPath: string) => {
      const target = resolveWorkspacePanelTarget(rawPath)
      if (!target) return

      setRightPanel(target.panel)
      setSelectedWorkspacePath(target.path)
    },
    [setRightPanel]
  )

  const persistSession = useCallback(
    (metadata: ChatSessionMetadata) => {
      setStoredSessionMetadata(metadata)
    },
    [setStoredSessionMetadata]
  )

  const selectedModel = models.find((model) => model.id === modelKey)
  const modelSelection = useMemo(
    () => toModelSelection(selectedModel),
    [selectedModel]
  )

  return {
    commandPaletteOpen,
    handleResourceCanvasResizeStart,
    handleThemePreferenceChange,
    initialSessionMetadata: storedSessionMetadata,
    modelKey,
    modelSelection,
    models,
    openWorkspacePath,
    persistSession,
    resourceCanvasWidth,
    rightPanel,
    selectedWorkspacePath,
    setCommandPaletteOpen,
    setModelKey,
    setRightPanel,
    setSelectedWorkspacePath,
    themePreference,
  }
}
