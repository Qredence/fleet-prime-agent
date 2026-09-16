import type { SessionTreeNode, SessionTreeSnapshot } from "@prime-agent/web-protocol/chat-protocol";
import { GitBranch } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { cn } from "../../../lib/utils";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogTitle,
} from "../../ui/alert-dialog";
import { Button } from "../../ui/button";

export type SessionTreePanelProps = {
	sessionId?: string;
	snapshot: SessionTreeSnapshot | null;
	loading: boolean;
	error?: string | null;
	isStreaming: boolean;
	selectedEntryId?: string | null;
	onSelectEntry: (entryId: string, messageId?: string) => void;
	onRefresh: () => void;
	onRewind: (entryId: string, expectedLeafId: string | null) => Promise<void>;
};

function flattenVisibleNodes(
	nodes: Array<SessionTreeNode>,
	depth = 0,
): Array<{ node: SessionTreeNode; depth: number }> {
	const rows: Array<{ node: SessionTreeNode; depth: number }> = [];
	for (const node of nodes) {
		rows.push({ node, depth });
		rows.push(...flattenVisibleNodes(node.children, depth + 1));
	}
	return rows;
}

function SessionTreeRow({
	depth,
	isSelected,
	node,
	onSelect,
}: {
	depth: number;
	isSelected: boolean;
	node: SessionTreeNode;
	onSelect: () => void;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			data-testid={`session-tree-node-${node.id}`}
			onClick={onSelect}
			className={cn(
				"h-auto w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left font-normal",
				isSelected ? "bg-foreground/10 ring-1 ring-foreground/15" : "hover:bg-foreground/6",
				node.isOnActiveBranch ? "text-foreground/90" : "text-foreground/55",
			)}
			style={{ marginLeft: `${depth * 12}px`, width: `calc(100% - ${depth * 12}px)` }}
		>
			<span className="flex items-center gap-1.5 text-label leading-5">
				{node.isLeaf ? (
					<span aria-hidden="true" className="font-semibold text-foreground">
						*
					</span>
				) : null}
				<span className="truncate font-medium">{node.preview}</span>
			</span>
			<span className="truncate font-mono text-caption text-foreground/40">{node.id}</span>
		</Button>
	);
}

/**
 * Read-only session tree panel with branch highlighting and rewind affordances.
 */
export function SessionTreePanel({
	sessionId,
	snapshot,
	loading,
	error,
	isStreaming,
	selectedEntryId,
	onSelectEntry,
	onRefresh,
	onRewind,
}: SessionTreePanelProps) {
	const [confirmEntryId, setConfirmEntryId] = useState<string | null>(null);
	const rows = useMemo(() => (snapshot ? flattenVisibleNodes(snapshot.nodes) : []), [snapshot]);
	const selectedNode = useMemo(
		() => rows.find((row) => row.node.id === selectedEntryId)?.node,
		[rows, selectedEntryId],
	);
	const canRewind = Boolean(
		selectedNode && snapshot && selectedEntryId && selectedEntryId !== snapshot.leafId && !isStreaming,
	);

	const resolveMessageId = useCallback(
		(node: SessionTreeNode) => {
			if (!sessionId || node.messageIndex === undefined) return undefined;
			return `${sessionId}-m${node.messageIndex}`;
		},
		[sessionId],
	);

	const handleConfirmRewind = useCallback(async () => {
		if (!confirmEntryId || !snapshot) return;
		await onRewind(confirmEntryId, snapshot.leafId);
		setConfirmEntryId(null);
	}, [confirmEntryId, onRewind, snapshot]);

	if (!sessionId) {
		return (
			<section
				aria-label="Session tree"
				className="flex min-h-36 items-center rounded-md border border-dashed border-border/70 px-4 text-center text-label leading-5 text-foreground/45"
			>
				Start or open a session to browse its branch history.
			</section>
		);
	}

	return (
		<section aria-label="Session tree" className="flex min-h-0 flex-1 flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2 text-label text-foreground/70">
					<GitBranch className="size-4" aria-hidden="true" />
					<span>Branch history</span>
				</div>
				<Button type="button" size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
					Refresh
				</Button>
			</div>

			{error ? (
				<p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-label text-destructive">
					{error}
				</p>
			) : null}

			{isStreaming ? (
				<p className="rounded-md border border-border/60 bg-background px-3 py-2 text-label text-foreground/60">
					Finish or stop the current turn before rewinding.
				</p>
			) : null}

			<div
				data-testid="session-tree-list"
				className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded-md border border-border/60 bg-background p-2"
			>
				{loading && rows.length === 0 ? (
					<p className="px-2 py-3 text-label text-foreground/45">Loading session tree…</p>
				) : null}
				{!loading && rows.length === 0 ? (
					<p className="px-2 py-3 text-label text-foreground/45">No branch entries yet.</p>
				) : null}
				{rows.map(({ node, depth }) => (
					<SessionTreeRow
						key={node.id}
						depth={depth}
						node={node}
						isSelected={node.id === selectedEntryId}
						onSelect={() => onSelectEntry(node.id, resolveMessageId(node))}
					/>
				))}
			</div>

			<div className="flex items-center justify-between gap-2">
				<p className="text-caption text-foreground/45">
					<span aria-hidden="true">*</span> marks the current leaf on the active branch.
				</p>
				<Button
					type="button"
					size="sm"
					disabled={!canRewind}
					onClick={() => selectedEntryId && setConfirmEntryId(selectedEntryId)}
				>
					Rewind here
				</Button>
			</div>

			<AlertDialog open={confirmEntryId !== null} onOpenChange={(open) => !open && setConfirmEntryId(null)}>
				<AlertDialogContent>
					<AlertDialogTitle>Rewind session?</AlertDialogTitle>
					<AlertDialogDescription>
						This replaces the live transcript from the selected entry forward. Later turns on the current branch
						will be removed from the active session.
					</AlertDialogDescription>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={() => void handleConfirmRewind()}>Rewind</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}
