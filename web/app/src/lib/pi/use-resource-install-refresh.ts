/**
 * use-resource-install-refresh — v1 no-op.
 *
 * fleet-pi's version polls the resource catalog and triggers cache
 * invalidation when an install completes. Per the drop list we remove the
 * polling loop but keep the hook interface so routes/index.tsx doesn't
 * need to be re-written.
 */
export function useResourceInstallRefresh(_opts?: {
	messages?: readonly unknown[];
	refreshResources?: () => void;
	refreshWorkspace?: () => void;
	sessionId?: string;
	shouldLoadWorkspaceTree?: boolean;
	workspaceTree?: unknown;
}): void {
	// no-op
}
