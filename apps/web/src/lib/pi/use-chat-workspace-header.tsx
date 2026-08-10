import { useNavigate } from "@tanstack/react-router"
import {
  AccountMenu,
  SessionControls,
} from "@prime-agent/web-design/components/fleet-pi/layout/chat-header"
import { RightPanelLauncherFromContext } from "@prime-agent/web-design/components/fleet-pi/pi/right-panel-launcher"
import type {
  ChatSessionInfo,
  ChatSessionMetadata,
} from "@prime-agent/web-protocol/chat-protocol"
import { clearBrowserChatSessions } from "@/lib/pi/use-chat-storage"
import { signOut, useOptionalUser } from "@/lib/auth-stub"
import { resetAnalytics } from "@/lib/analytics-stub"

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

  return {
    left: (
      <AccountMenu
        user={user}
        onSignOut={async () => {
          clearBrowserChatSessions()
          await signOut()
          resetAnalytics()
          void navigate({ to: "/" })
        }}
        onSignIn={() => void navigate({ to: "/" })}
        onOpenSettings={onOpenSettings}
      />
    ),
    center: (
      <SessionControls
        activeSessionId={activeSessionId}
        activeSessionLabel={activeSessionLabel}
        sessions={sessions}
        onNewSession={onNewSession}
        onResumeSession={onResumeSession}
      />
    ),
    right: <RightPanelLauncherFromContext />,
  }
}
