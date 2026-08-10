import { RefreshCw, X } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { DESKTOP_PANEL_HIDDEN_FLEX } from "../../../lib/layout-constants"
import { HIT_AREA_EXPAND_DENSE_CLASS } from "../styles/tokens"
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react"

export function ResizableCanvas({
  children,
  dataTestid,
  loading,
  onClose,
  onRefresh,
  onResizeStart,
  open,
  headerActions,
  title,
  titleIcon: TitleIcon,
  width,
}: {
  children: ReactNode
  dataTestid?: string
  headerActions?: ReactNode
  loading: boolean
  onClose: () => void
  onRefresh?: () => void
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void
  open: boolean
  title: string
  titleIcon: React.ElementType
  width: number
}) {
  const reduceMotion = useReducedMotion()
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={reduceMotion ? false : { x: width, opacity: 0.8 }}
          animate={{ x: 0, opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { x: width, opacity: 0.8 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.2, ease: "easeInOut" }
          }
          className={`relative h-full shrink-0 border-l border-border/70 bg-background/95 ${DESKTOP_PANEL_HIDDEN_FLEX}`}
          data-testid={dataTestid}
          style={{ width }}
        >
          <button
            type="button"
            aria-label={`Resize ${title} panel`}
            className="absolute top-0 bottom-0 left-0 z-10 w-2 -translate-x-1 cursor-col-resize touch-none bg-transparent transition-colors outline-none hover:bg-foreground/10 focus-visible:bg-foreground/10"
            data-testid="pi-resources-resize-handle"
            onPointerDown={onResizeStart}
          />
          <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-3">
              <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-foreground/80">
                <TitleIcon className="size-3.5 shrink-0" />
                <span>{title}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {headerActions}
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={!onRefresh}
                  className={`${HIT_AREA_EXPAND_DENSE_CLASS} inline-flex h-7 w-7 items-center justify-center rounded-sm text-foreground/40 transition-[background-color,color,transform] duration-150 hover:bg-foreground/6 hover:text-foreground/70 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-foreground/40 disabled:active:scale-100`}
                  aria-label={`Refresh ${title}`}
                  title={`Refresh ${title}`}
                >
                  <RefreshCw
                    className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className={`${HIT_AREA_EXPAND_DENSE_CLASS} inline-flex h-7 w-7 items-center justify-center rounded-sm text-foreground/40 transition-[background-color,color,transform] duration-150 hover:bg-foreground/6 hover:text-foreground/70 active:scale-[0.96]`}
                  aria-label="Close panel"
                  title="Close panel"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2">{children}</div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
