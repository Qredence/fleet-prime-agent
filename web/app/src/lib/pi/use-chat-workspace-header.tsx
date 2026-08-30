import { useNavigate } from "@tanstack/react-router"
import {
  AccountMenu,
  KernelStatusChip,
  SessionControls,
} from "@prime-agent/web-design/components/product/fleet-pi/layout/chat-header"
import { RightPanelLauncherFromContext } from "@prime-agent/web-design/components/product/fleet-pi/pi/right-panel-launcher"
import { AnimatedSidebarTrigger } from "@prime-agent/web-design/components/registry/beui/motion/animated-sidebar"
import type {
  ChatSessionInfo,
  ChatSessionMetadata,
} from "@prime-agent/web-protocol/chat-protocol"
import { clearBrowserChatSessions } from "@/lib/pi/use-chat-storage"
import { signOut, useOptionalUser } from "@/lib/auth-stub"
import { resetAnalytics } from "@/lib/analytics-stub"
import { useKernelHealth } from "@/lib/pi/use-kernel-health"

type UseChatWorkspaceHeaderOptions = {
  activeSessionId: string | undefined
  activeSessionLabel: string
  sessions: Array<ChatSessionInfo>
  onNewSession: () => void
  onResumeSession: (metadata: ChatSessionMetadata) => void
  onOpenSettings: () => void
}

export function useChatWorkspaceHeader({
  activeSessionId,
  activeSessionLabel,
  sessions,
  onNewSession,
  onResumeSession,
  onOpenSettings,
}: UseChatWorkspaceHeaderOptions) {
  const navigate = useNavigate()
  const user = useOptionalUser()
  const kernel = useKernelHealth()

  return {
    left: (
      <AnimatedSidebarTrigger
        aria-label="Toggle conversations"
        className="size-9 rounded-[10px] border border-border/70 bg-background shadow-sm"
      >
        <span
          aria-hidden="true"
          data-icon="inline-start"
          className="block h-3.5 w-4 rounded-[3px] border border-current before:block before:h-full before:w-1 before:border-r before:border-current"
        />
      </AnimatedSidebarTrigger>
    ),
    accountMenu: (
      <AccountMenu
        className="w-full"
        label="Qredence"
        user={user}
        onSignOut={async () => {
          clearBrowserChatSessions()
          await signOut()
          resetAnalytics()
          void navigate({ to: "/" })
        }}
        onOpenSettings={onOpenSettings}
      />
    ),
    center: (
      <>
        <SessionControls
          activeSessionId={activeSessionId}
          activeSessionLabel={activeSessionLabel}
          sessions={sessions}
          onNewSession={onNewSession}
          onResumeSession={onResumeSession}
        />
        <KernelStatusChip ok={kernel?.ok ?? null} reason={kernel?.reason} />
      </>
    ),
    right: <RightPanelLauncherFromContext />,
  }
}
