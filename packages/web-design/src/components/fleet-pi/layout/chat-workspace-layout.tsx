import {
  CHAT_CHROME_TOP_PX,
  CHAT_HEADER_HEIGHT_PX,
  CHAT_HEADER_OFFSET_PX,
} from "../../../lib/layout-constants"
import { cn } from "../../../lib/utils"
import { CHAT_HEADER_LAYER_CLASS } from "../styles/tokens"
import type { CSSProperties, ReactNode } from "react"

export function ChatWorkspaceLayout({
  children,
  headerCenter,
  headerLeft,
  headerRight,
  panel,
}: {
  children: ReactNode
  headerCenter: ReactNode
  headerLeft: ReactNode
  headerRight?: ReactNode
  panel: ReactNode
}) {
  const layoutStyle = {
    "--chat-chrome-top": `${CHAT_CHROME_TOP_PX}px`,
    "--chat-header-height": `${CHAT_HEADER_HEIGHT_PX}px`,
    "--chat-header-top": `${CHAT_HEADER_OFFSET_PX}px`,
  } as CSSProperties

  return (
    <div
      className="grid h-svh min-w-0 grid-rows-[auto_1fr] overflow-hidden"
      data-testid="chat-shell"
      style={layoutStyle}
    >
      <header
        className={cn(
          CHAT_HEADER_LAYER_CLASS,
          "grid min-h-[calc(var(--chat-header-top)+var(--chat-header-height))] shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 px-3 pt-[var(--chat-header-top)] pb-3"
        )}
        data-testid="chat-header"
      >
        <div className="justify-self-start">{headerLeft}</div>
        <div className="flex min-w-0 items-center justify-center gap-2 justify-self-center">
          {headerCenter}
        </div>
        <div className="justify-self-end">{headerRight}</div>
      </header>
      <div className="flex min-h-0 min-w-0 overflow-hidden">
        <div
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          data-testid="chat-column"
        >
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
        {panel}
      </div>
    </div>
  )
}
