import { useNavigate } from "@tanstack/react-router"
import {
  AccountMenu,
} from "@prime-agent/web-design/components/product/fleet-pi/layout/chat-header"
import {
  AgentTabBar,
  type AgentTabItem,
} from "@prime-agent/web-design/components/product/fleet-pi/layout/agent-tab-bar"
import { RightPanelLauncherFromContext } from "@prime-agent/web-design/components/product/fleet-pi/pi/right-panel-launcher"
import { AnimatedSidebarTrigger } from "@prime-agent/web-design/components/registry/beui/motion/animated-sidebar"
import { clearBrowserChatSessions } from "@/lib/pi/use-chat-storage"
import { signOut, useOptionalUser } from "@/lib/auth-stub"
import { resetAnalytics } from "@/lib/analytics-stub"

type UseChatWorkspaceHeaderOptions = {
  activeTabId: string
  tabs: Array<AgentTabItem>
  onCloseTab: (tabId: string) => void
  onNewSession: () => void
  onSelectTab: (tabId: string) => void
  onOpenSettings: () => void
}

/**
 * Builds the chat workspace header UI and its interaction handlers.
 *
 * @returns The sidebar trigger, account menu, tab bar, and right-panel launcher.
 */
export function useChatWorkspaceHeader({
  activeTabId,
  tabs,
  onCloseTab,
  onNewSession,
  onSelectTab,
  onOpenSettings,
}: UseChatWorkspaceHeaderOptions) {
  const navigate = useNavigate()
  const user = useOptionalUser()

  return {
    left: (
      <AnimatedSidebarTrigger
        aria-label="Toggle conversations"
        className="!size-7 !rounded-[7px] border border-border/70 bg-background shadow-sm"
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
      <AgentTabBar
        tabs={tabs}
        value={activeTabId}
        onValueChange={onSelectTab}
        onClose={onCloseTab}
        onNewSession={onNewSession}
      />
    ),
    right: <RightPanelLauncherFromContext compact />,
  }
}
