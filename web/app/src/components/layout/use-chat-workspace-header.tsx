import { useNavigate } from "@tanstack/react-router";
import { clearBrowserChatSessions } from "@/components/chat/use-chat-storage";
import { AnimatedSidebarTrigger } from "@/components/layout/animated-sidebar";
import { AccountMenu } from "@/components/layout/chat-header";
import { AgentTabBar, type AgentTabItem } from "@/components/sessions/agent-tab-bar";
import { RightPanelLauncherFromContext } from "@/components/workspace/right-panel-launcher";
import { resetAnalytics } from "@/lib/analytics-stub";
import { signOut, useOptionalUser } from "@/lib/auth-stub";

type UseChatWorkspaceHeaderOptions = {
	activeTabId: string;
	tabs: Array<AgentTabItem>;
	onCloseTab: (tabId: string) => void;
	onNewSession: () => void;
	onSelectTab: (tabId: string) => void;
	onOpenSettings: () => void;
};

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
	const navigate = useNavigate();
	const user = useOptionalUser();

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
					clearBrowserChatSessions();
					await signOut();
					resetAnalytics();
					void navigate({ to: "/" });
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
	};
}
