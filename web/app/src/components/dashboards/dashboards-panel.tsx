import type { PrimeAgentArtifact } from "@prime-agent/web-protocol/chat-protocol";
import { DashboardBoard, dashboardRecord } from "@/components/dashboards/dashboard-view";
import { Button } from "@/components/ui/button";

/**
 * Lists the session's boards and draws the selected one open, in the app theme.
 * A button on the board sends its message through the chat action path.
 */
export function DashboardsPanel({
	artifacts,
	selectedArtifactId,
	sessionId,
	onOpenUIAction,
	onSelect,
}: {
	artifacts: readonly PrimeAgentArtifact[];
	selectedArtifactId?: string | null;
	sessionId?: string;
	onOpenUIAction?: (message: string) => void;
	onSelect?: (artifactId: string) => void;
}) {
	const boards = artifacts.filter((artifact) => dashboardRecord(artifact) !== undefined);
	const selected = boards.find((board) => board.id === selectedArtifactId) ?? boards[0];
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			{boards.length === 0 ? (
				<p className="text-sm text-muted-foreground">No dashboards in this session.</p>
			) : (
				<div className="flex flex-col gap-1">
					{boards.map((board) => (
						<Button
							key={board.id}
							type="button"
							variant={board.id === selected?.id ? "secondary" : "ghost"}
							size="compact"
							className="justify-start"
							aria-pressed={board.id === selected?.id}
							onClick={() => onSelect?.(board.id)}
						>
							{board.title || "Dashboard"}
						</Button>
					))}
				</div>
			)}
			{selected ? (
				<div className="min-h-0 flex-1 overflow-auto">
					<DashboardBoard artifact={selected} sessionId={sessionId} onOpenUIAction={onOpenUIAction} />
				</div>
			) : null}
		</div>
	);
}
