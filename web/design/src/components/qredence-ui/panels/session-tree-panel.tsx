import type { SessionTreeNode, SessionTreeSnapshot } from "@prime-agent/web-protocol/chat-protocol";
import { GitBranch } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../../../lib/utils";
import {
	AlertDialog,
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
	const [confirmExpectedLeafId, setConfirmExpectedLeafId] = useState<string | null>(null);
	const [confirming, setConfirming] = useState(false);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	const rows = useMemo(() => (snapshot ? flattenVisibleNodes(snapshot.nodes) : []), [snapshot]);
	const selectedNode = useMemo(
		() => rows.find((row) => row.node.id === selectedEntryId)?.node,
		[rows, selectedEntryId],
	);
	const canRewind = Boolean(
		selectedNode && snapshot && selectedEntryId && selectedEntryId !== snapshot.leafId && !isStreaming,
	);

	// After a partial rewind failure reconciles the tree, re-arm the lock so retry
	// does not 409 against the open-time leaf while the dialog stays open.
	useEffect(() => {
		if (confirmEntryId === null || confirming || confirmError === null) return;
		const nextLeaf = snapshot?.leafId ?? null;
		if (nextLeaf === confirmExpectedLeafId) return;
		setConfirmExpectedLeafId(nextLeaf);
	}, [confirmEntryId, confirming, confirmError, confirmExpectedLeafId, snapshot?.leafId]);

	const resolveMessageId = useCallback(
		(node: SessionTreeNode) => {
			if (!sessionId || node.messageIndex === undefined) return undefined;
			return `${sessionId}-m${node.messageIndex}`;
		},
		[sessionId],
	);

	const clearConfirm = useCallback(() => {
		setConfirmEntryId(null);
		setConfirmExpectedLeafId(null);
		setConfirmError(null);
		setConfirming(false);
	}, []);

	// Drop stale confirm state when the panel follows a different session.
	useEffect(() => {
		clearConfirm();
	}, [sessionId, clearConfirm]);

	const handleConfirmRewind = useCallback(async () => {
		// Capture before any dialog close/state clear — AlertDialogAction/Close must not race this.
		const entryId = confirmEntryId;
		const leafId = confirmExpectedLeafId;
		if (!entryId) return;
		setConfirming(true);
		setConfirmError(null);
		try {
			await onRewind(entryId, leafId);
			clearConfirm();
		} catch (caught) {
			setConfirmError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setConfirming(false);
		}
	}, [clearConfirm, confirmEntryId, confirmExpectedLeafId, onRewind]);

	const openConfirm = useCallback(
		(entryId: string) => {
			setConfirmError(null);
			setConfirmEntryId(entryId);
			// Lock the leaf at dialog open for optimistic concurrency while the dialog is open.
			setConfirmExpectedLeafId(snapshot?.leafId ?? null);
		},
		[snapshot?.leafId],
	);

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
					onClick={() => selectedEntryId && openConfirm(selectedEntryId)}
				>
					Rewind here
				</Button>
			</div>

			<AlertDialog
				open={confirmEntryId !== null}
				onOpenChange={(open) => {
					if (!open && !confirming) clearConfirm();
				}}
			>
				<AlertDialogContent>
					<AlertDialogTitle>Rewind session?</AlertDialogTitle>
					<AlertDialogDescription>
						Later turns on the current branch leave the active session. Rewinding to a user turn follows Prime
						Agent edit-from-here semantics: the leaf moves to that message&apos;s parent so you can resend from
						there.
					</AlertDialogDescription>
					{confirmError ? (
						<p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-label text-destructive">
							{confirmError}
						</p>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={confirming}>Cancel</AlertDialogCancel>
						{/* Use a real Button — AlertDialogAction is Close and was racing/swallowing async rewind. */}
						<Button
							type="button"
							variant="destructive"
							disabled={confirming}
							onClick={() => void handleConfirmRewind()}
						>
							{confirming ? "Rewinding…" : "Rewind"}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}
