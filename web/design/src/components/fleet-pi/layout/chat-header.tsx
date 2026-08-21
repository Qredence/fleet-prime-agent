import {
  BookOpenText,
  ChevronDown,
  History,
  LogOut,
  Plus,
  Settings,
} from "lucide-react"
import { Popover } from "../../agents/input/popover"
import { ChromePillButton } from "../primitives/chrome-pill"
import { cn } from "../../../lib/utils"
import type {
  ChatSessionInfo,
  ChatSessionMetadata,
} from "@prime-agent/web-protocol/chat-protocol"

export const DOCUMENTATION_URL = "https://docs.qredence.ai"

export function QredenceLogo({ className }: { className?: string }) {
  return (
    <svg
      width="97"
      height="93"
      viewBox="0 0 97 93"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M53.72 0.17C53.27 0.24 52.22 0.43 51.40 0.60C50.58 0.78 49.27 1.11 48.49 1.36C47.71 1.61 46.34 2.17 45.43 2.60C44.52 3.03 43.18 3.79 42.44 4.29C41.71 4.78 40.62 5.62 40.06 6.14C39.47 6.65 38.58 7.54 38.06 8.12C37.53 8.69 36.68 9.81 36.16 10.59C35.65 11.36 34.92 12.65 34.56 13.42C34.20 14.20 33.73 15.38 33.50 16.04C33.29 16.69 32.98 17.83 32.83 18.57C32.67 19.31 32.46 20.65 32.35 21.56C32.26 22.49 32.22 24.04 32.26 25.14C32.31 26.22 32.52 28.03 32.73 29.17C32.93 30.32 33.31 31.97 33.55 32.83C33.79 33.70 34.29 35.24 34.68 36.27C35.07 37.30 35.77 38.97 36.26 40.00C36.76 41.03 37.64 42.67 38.22 43.66C38.80 44.64 39.73 46.12 40.28 46.94C40.83 47.76 41.76 49.05 42.31 49.79C42.88 50.55 44.06 51.99 44.92 53.00C45.79 54.02 46.95 55.36 47.52 55.97C48.07 56.59 50.28 58.93 52.43 61.18C54.58 63.42 58.20 67.08 60.48 69.32C64.30 73.02 64.62 73.38 64.36 73.56C64.21 73.68 63.57 74.02 62.94 74.35C62.30 74.67 61.26 75.14 60.63 75.40C59.99 75.65 58.90 76.04 58.20 76.28C57.49 76.50 56.28 76.83 55.51 77.00C54.73 77.16 53.39 77.41 52.52 77.53C51.57 77.68 49.92 77.77 48.31 77.77C46.65 77.77 45.03 77.68 43.98 77.53C43.06 77.40 41.41 77.07 40.35 76.80C39.29 76.53 37.74 76.07 36.92 75.76C36.10 75.44 34.70 74.83 33.79 74.37C32.87 73.92 31.58 73.20 30.87 72.77C30.17 72.34 28.96 71.49 28.19 70.89C27.41 70.28 26.07 69.08 25.20 68.22C24.33 67.35 23.05 65.87 22.35 64.93C21.65 63.99 20.77 62.71 20.39 62.10C20.02 61.48 19.48 60.51 19.18 59.93C18.90 59.35 18.41 58.27 18.11 57.54C17.80 56.81 17.35 55.53 17.11 54.70C16.85 53.88 16.50 52.48 16.30 51.57C16.11 50.66 15.87 48.88 15.77 47.61C15.63 45.87 15.63 44.73 15.75 42.98C15.85 41.72 16.06 39.97 16.24 39.10C16.42 38.24 16.74 36.92 16.94 36.19C17.15 35.46 17.59 34.18 17.91 33.36C18.24 32.53 18.89 31.13 19.35 30.22C19.81 29.31 20.57 28.01 21.04 27.31C21.48 26.61 22.29 25.50 22.81 24.85C23.33 24.19 24.48 22.92 25.36 22.01C26.31 21.02 27.11 20.05 27.34 19.57C27.56 19.16 27.84 18.38 27.96 17.87C28.08 17.35 28.19 16.56 28.19 16.11C28.19 15.66 28.08 14.86 27.95 14.31C27.83 13.78 27.53 12.98 27.28 12.53C27.04 12.08 26.53 11.38 26.14 10.98C25.74 10.57 25.10 10.02 24.68 9.75C24.27 9.48 23.53 9.11 23.04 8.94C22.54 8.77 21.66 8.59 21.09 8.54C20.40 8.49 19.72 8.55 19.05 8.71C18.48 8.84 17.65 9.12 17.18 9.35C16.59 9.63 15.79 10.26 14.63 11.41C13.69 12.30 12.38 13.71 11.72 14.53C11.05 15.33 10.05 16.60 9.51 17.37C8.97 18.11 8.17 19.29 7.73 19.99C7.30 20.69 6.48 22.13 5.93 23.20C5.37 24.28 4.64 25.80 4.31 26.61C3.97 27.40 3.43 28.85 3.09 29.80C2.76 30.77 2.30 32.34 2.06 33.28C1.82 34.22 1.45 35.94 1.25 37.09C1.04 38.24 0.81 39.95 0.72 40.89C0.64 41.84 0.57 43.75 0.57 45.15C0.57 46.55 0.64 48.46 0.72 49.40C0.81 50.35 1.00 51.96 1.18 52.99C1.34 54.02 1.75 55.87 2.06 57.09C2.37 58.33 2.94 60.21 3.33 61.27C3.72 62.33 4.42 64.05 4.88 65.08C5.34 66.11 6.14 67.65 6.61 68.52C7.09 69.38 8.02 70.86 8.64 71.80C9.29 72.74 10.36 74.22 11.06 75.08C11.75 75.95 12.85 77.22 13.50 77.91C14.14 78.59 15.38 79.80 16.24 80.58C17.11 81.35 18.45 82.49 19.23 83.07C20.01 83.67 21.45 84.68 22.44 85.33C23.42 85.97 25.17 86.98 26.32 87.58C27.47 88.16 29.32 89.01 30.43 89.46C31.53 89.91 33.11 90.48 33.93 90.73C34.76 90.98 36.10 91.36 36.92 91.57C37.74 91.76 39.19 92.07 40.13 92.24C41.07 92.40 42.92 92.64 44.24 92.78C45.55 92.90 47.40 93 48.34 93C49.28 93 51.10 92.90 52.37 92.78C53.64 92.66 55.49 92.42 56.48 92.24C57.46 92.07 58.94 91.76 59.76 91.55C60.58 91.36 61.90 90.98 62.67 90.73C63.45 90.48 64.93 89.94 65.96 89.54C66.99 89.13 68.71 88.36 69.77 87.82L69.80 87.80L69.80 87.80C70.85 87.27 71.95 86.71 72.23 86.54C72.51 86.37 73.47 85.77 74.36 85.21L75.96 84.19C78.34 86.36 80.13 88.00 81.49 89.25C83.14 90.76 84.26 91.67 84.92 92.01C85.46 92.30 86.32 92.64 86.86 92.76C87.40 92.90 88.13 93 88.50 93C88.88 93 89.58 92.90 90.07 92.78C90.56 92.64 91.37 92.34 91.86 92.10C92.36 91.87 93.03 91.45 93.34 91.18C93.67 90.91 94.24 90.28 94.59 89.79C94.95 89.30 95.37 88.54 95.54 88.12C95.68 87.69 95.88 86.88 95.97 86.33C96.06 85.67 96.06 84.95 95.97 84.31C95.88 83.74 95.61 82.85 95.36 82.30C95.10 81.73 94.71 81.04 94.49 80.76C94.25 80.47 92.44 78.74 90.46 76.92C88.49 75.08 86.86 73.56 86.86 73.52C86.86 73.47 87.47 72.52 88.22 71.40C88.97 70.26 90.12 68.26 90.77 66.95C91.44 65.63 92.31 63.74 92.70 62.74C93.10 61.72 93.67 60.11 93.95 59.15C94.25 58.18 94.65 56.69 94.85 55.82C95.04 54.96 95.31 53.64 95.43 52.91C95.57 52.18 95.76 50.49 95.89 49.18C96.01 47.87 96.12 46.12 96.12 45.30C96.12 44.48 96.01 42.70 95.89 41.34C95.77 39.98 95.54 38.10 95.36 37.16C95.19 36.22 94.89 34.77 94.68 33.95C94.48 33.13 94.07 31.73 93.77 30.82C93.49 29.91 93.00 28.53 92.68 27.76C92.37 26.98 91.83 25.73 91.50 24.99C91.16 24.26 90.43 22.84 89.88 21.86C89.34 20.87 88.32 19.23 87.62 18.20C86.94 17.17 85.73 15.53 84.95 14.54C84.16 13.56 82.53 11.77 81.34 10.57C80.14 9.38 78.47 7.84 77.60 7.15C76.74 6.47 75.23 5.38 74.25 4.72C73.26 4.08 71.72 3.18 70.81 2.75C69.90 2.30 68.56 1.73 67.83 1.48C67.09 1.21 65.94 0.88 65.29 0.72C64.63 0.57 63.36 0.35 62.45 0.21C61.35 0.06 59.78 -0.01 57.67 0.00C55.94 0.02 54.16 0.09 53.72 0.17ZM54.24 15.47C54.82 15.33 55.45 15.20 55.66 15.17C55.87 15.13 56.81 15.10 57.75 15.08C58.69 15.08 60.08 15.16 60.81 15.28C61.54 15.38 62.56 15.63 63.05 15.83C63.54 16.04 64.38 16.44 64.91 16.74C65.45 17.04 66.57 17.78 67.41 18.41C68.26 19.04 69.63 20.23 70.48 21.07C71.32 21.92 72.47 23.17 73.04 23.87C73.60 24.58 74.54 25.88 75.14 26.79C75.75 27.70 76.60 29.13 77.07 30.00C77.51 30.86 78.19 32.30 78.55 33.21C78.90 34.12 79.43 35.58 79.68 36.49C79.93 37.40 80.29 38.86 80.46 39.77C80.68 40.89 80.80 42.31 80.84 44.25C80.90 45.97 80.86 47.67 80.75 48.58C80.67 49.40 80.41 50.88 80.22 51.87C80.01 52.85 79.53 54.57 79.16 55.68C78.78 56.78 78.08 58.50 77.60 59.48C77.13 60.47 76.47 61.66 75.59 63.02L73.35 60.81C72.11 59.59 69.30 56.78 67.09 54.56C64.88 52.35 62.12 49.51 60.97 48.29C59.81 47.05 58.17 45.24 57.30 44.25C56.43 43.27 55.28 41.90 54.75 41.19C54.19 40.49 53.28 39.22 52.72 38.36C52.15 37.49 51.39 36.28 51.03 35.67C50.67 35.06 50.09 33.94 49.75 33.21C49.40 32.47 48.88 31.16 48.58 30.29C48.28 29.43 47.89 28.07 47.74 27.26C47.55 26.34 47.45 25.22 47.45 24.13C47.45 23.17 47.55 22.05 47.67 21.52C47.79 21.01 48.10 20.17 48.36 19.65C48.63 19.13 49.24 18.32 49.75 17.80C50.43 17.11 50.98 16.74 51.93 16.29C52.63 15.96 53.66 15.59 54.24 15.47Z"
        fill="currentColor"
      />
    </svg>
  )
}

export { ChromePillButton as HeaderPillButton }

export type AccountMenuUser = {
  name?: string | null
  email?: string | null
}

export function AccountMenu({
  user,
  onSignOut,
  onOpenSettings,
  compact = false,
  label = "Fleet Prime Agent",
  className,
}: {
  user: AccountMenuUser | null
  onSignOut: () => Promise<void> | void
  onOpenSettings?: () => void
  compact?: boolean
  label?: string
  className?: string
}) {
  const menuItemClass =
    "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-label leading-4 text-foreground transition-colors hover:bg-foreground/6"

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <Popover
        side="bottom"
        align="start"
        trigger={
          <ChromePillButton
            ariaLabel="Open account menu"
            className={cn(
              "min-w-0",
              compact ? "size-8 justify-center px-2" : "w-full justify-start",
            )}
          >
            <QredenceLogo className="size-3.5 shrink-0" />
            <span
              className={
                compact
                  ? "sr-only"
                  : "text-[13px] font-medium tracking-[-0.01em] whitespace-nowrap"
              }
            >
              {label}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-foreground/35" />
          </ChromePillButton>
        }
      >
        {user ? (
          <>
            <div className="px-2 py-1.5 text-label leading-4 text-foreground/50">
              {user.name || user.email}
            </div>
            <button type="button" className={menuItemClass}>
              <QredenceLogo className="size-3.5 shrink-0 text-foreground/50" />
              <span className="truncate">Account</span>
            </button>
            <a
              href={DOCUMENTATION_URL}
              target="_blank"
              rel="noreferrer"
              className={menuItemClass}
            >
              <BookOpenText className="size-3.5 shrink-0 text-foreground/50" />
              <span className="truncate">Documentation</span>
            </a>
            {onOpenSettings && (
              <button
                type="button"
                className={menuItemClass}
                onClick={onOpenSettings}
              >
                <Settings className="size-3.5 shrink-0 text-foreground/50" />
                <span className="truncate">Settings</span>
              </button>
            )}
            <button
              type="button"
              className={menuItemClass}
              onClick={() => void onSignOut()}
            >
              <LogOut className="size-3.5 shrink-0 text-foreground/50" />
              <span className="truncate">Sign out</span>
            </button>
          </>
        ) : (
          <>
            <a
              href={DOCUMENTATION_URL}
              target="_blank"
              rel="noreferrer"
              className={menuItemClass}
            >
              <BookOpenText className="size-3.5 shrink-0 text-foreground/50" />
              <span className="truncate">Documentation</span>
            </a>
            {onOpenSettings && (
              <button
                type="button"
                className={menuItemClass}
                onClick={onOpenSettings}
              >
                <Settings className="size-3.5 shrink-0 text-foreground/50" />
                <span className="truncate">Settings</span>
              </button>
            )}
          </>
        )}
      </Popover>
    </div>
  )
}

export function SessionControls({
  activeSessionId,
  activeSessionLabel,
  onNewSession,
  onResumeSession,
  sessions,
}: {
  activeSessionId?: string
  activeSessionLabel: string
  onNewSession: () => void
  onResumeSession: (metadata: ChatSessionMetadata) => void
  sessions: Array<ChatSessionInfo>
}) {
  return (
    <>
      <Popover
        side="bottom"
        align="center"
        className="w-[min(360px,calc(100vw-2rem))]"
        overlay
        trigger={
          <ChromePillButton
            ariaLabel="Open conversations"
            className="w-28 justify-between sm:w-36 md:w-44 lg:w-52 xl:w-64"
          >
            <div className="flex min-w-0 items-center gap-2">
              <History className="size-3 shrink-0 text-foreground/35" />
              <span className="min-w-0 truncate text-left">
                {activeSessionLabel}
              </span>
            </div>
            <ChevronDown className="size-3.5 shrink-0 text-foreground/35" />
          </ChromePillButton>
        }
      >
        {sessions.length === 0 ? (
          <div className="px-2 py-2 text-label text-foreground/45">
            No saved conversations yet.
          </div>
        ) : (
          sessions.map((session) => {
            const label = session.title
            const active = session.sessionId === activeSessionId
            return (
              <button
                key={session.sessionId}
                type="button"
                onClick={() =>
                  onResumeSession({ sessionId: session.sessionId })
                }
                className={`flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-label leading-4 transition-colors hover:bg-foreground/6 ${
                  active ? "bg-foreground/6 text-foreground" : "text-foreground"
                }`}
              >
                <History className="size-3 shrink-0 text-foreground/45" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>
            )
          })
        )}
      </Popover>
      <ChromePillButton ariaLabel="New session" onClick={onNewSession}>
        <Plus className="size-3.5 shrink-0" />
      </ChromePillButton>
    </>
  )
}

export function KernelStatusChip(_props: {
  ok: boolean | null
  reason?: string
}) {
  // Hidden — removed from UI per user request
  return null
}
