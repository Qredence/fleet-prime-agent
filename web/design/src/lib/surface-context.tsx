import { createContext, useContext, type ReactNode } from "react"

/**
 * Tracks the current substrate elevation level (Fluid Functionalism surfaces).
 *
 * Elevated components (dropdowns, dialogs, sheets) read it via useSurface()
 * and render at substrate + offset, then re-provide their own level so
 * further nesting elevates further.
 */
const SurfaceContext = createContext<number>(1)

export function useSurface(): number {
  return useContext(SurfaceContext)
}

export function SurfaceProvider({
  value,
  children,
}: {
  value: number
  children: ReactNode
}) {
  return (
    <SurfaceContext.Provider value={Math.max(1, Math.min(8, value))}>
      {children}
    </SurfaceContext.Provider>
  )
}
