import { ChevronRight, LayoutTemplate } from "lucide-react"
import { useMemo, useState } from "react"
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types"

import { GenerativeTextRenderer } from "../../openui/inline-renderer"
import { Button } from "../../button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../collapsible"
import { UiErrorBoundary } from "../ui-error-boundary"
import { WorkspacePanelContent } from "./workspace-panel"
import { collectSessionOpenUIBlocks, getArtifactsScopePath } from "./artifacts-utils"
import { findWorkspaceNode } from "./shared"
import type { SessionOpenUIBlock } from "./artifacts-utils"
import type { WorkspacePanelContentProps } from "./workspace-panel"

type ArtifactsPanelContentProps = Pick<
	WorkspacePanelContentProps,
	| "error"
	| "loadWorkspaceFile"
	| "loading"
	| "onSelectedPathChange"
	| "selectedPath"
	| "workspace"
> & {
	messages: Array<ChatMessage>
	onOpenUIAction?: (message: string) => void
	status: ChatStatus
}

function GenerativeUiBlockRow({
	block,
	expanded,
	isStreaming,
	onOpenUIAction,
	onToggle,
}: {
	block: SessionOpenUIBlock
	expanded: boolean
	isStreaming: boolean
	onOpenUIAction?: (message: string) => void
	onToggle: () => void
}) {
	return (
		<Collapsible open={expanded} onOpenChange={onToggle}>
			<CollapsibleTrigger
				render={
					<Button
						variant="ghost"
						size="sm"
						className="group w-full justify-start gap-1.5 text-left text-label font-normal text-foreground/65 transition-none hover:bg-foreground/5 hover:text-foreground/80"
					/>
				}
			>
				<ChevronRight className="size-3 shrink-0 text-foreground/35 transition-transform group-data-panel-open:rotate-90" />
				<LayoutTemplate className="size-3.5 shrink-0 text-foreground/35" />
				<span className="min-w-0 flex-1 truncate" title={block.component}>
					{block.component}
				</span>
				<span className="shrink-0 text-[10px] text-foreground/40">#{block.ordinal}</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="mb-1 mt-0.5 flex min-w-0 flex-col overflow-hidden rounded-md border border-border/60 bg-background px-2.5 py-2">
					<UiErrorBoundary resetKeys={[block.content]}>
						<GenerativeTextRenderer
							content={block.content}
							isStreaming={isStreaming}
							messageId={block.blockId}
							onOpenUIAction={onOpenUIAction}
						/>
					</UiErrorBoundary>
				</div>
			</CollapsibleContent>
		</Collapsible>
	)
}

export function ArtifactsPanelContent({
	error,
	loadWorkspaceFile,
	loading,
	messages,
	onOpenUIAction,
	onSelectedPathChange,
	selectedPath,
	status,
	workspace,
}: ArtifactsPanelContentProps) {
	const scopePath = workspace ? getArtifactsScopePath(workspace.root) : undefined
	const blocks = useMemo(() => collectSessionOpenUIBlocks(messages), [messages])
	const hasArtifactFiles = useMemo(() => {
		if (!workspace || !scopePath) return false
		const root = findWorkspaceNode(workspace.nodes, scopePath)
		return Boolean(root?.children?.length)
	}, [scopePath, workspace])
	const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null)
	const latestStreaming = status === "streaming" ? blocks.at(-1)?.blockId : undefined

	return (
		<div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
			<div className="flex min-h-0 flex-col">
				<div className="mb-2 flex min-w-0 items-center gap-2 rounded-sm bg-foreground/5 px-2 py-1.5">
					<LayoutTemplate className="size-3.5 shrink-0 text-foreground/45" />
					<span className="min-w-0 flex-1 truncate text-label font-medium text-foreground/70">
						Generative UI
					</span>
					<span className="shrink-0 text-[10px] text-foreground/40">
						{blocks.length > 0 ? `${blocks.length}` : "none yet"}
					</span>
				</div>
				{blocks.length === 0 ? (
					<p className="px-2 pb-1 text-[11px] leading-4 text-foreground/40">
						OpenUI interfaces the agent generates in this session appear here, and can be
						re-opened without scrolling the conversation. Files written to
						agent-workspace/artifacts show below once the agent creates them.
					</p>
				) : (
					<div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
						{blocks.map((block) => (
							<GenerativeUiBlockRow
								key={block.blockId}
								block={block}
							expanded={block.blockId === expandedBlockId}
								isStreaming={block.blockId === latestStreaming}
								onOpenUIAction={onOpenUIAction}
								onToggle={() =>
									setExpandedBlockId((current) =>
										current === block.blockId ? null : block.blockId,
									)
								}
							/>
						))}
					</div>
				)}
			</div>
			{hasArtifactFiles && (
				<div className="min-h-0 flex-1">
					<WorkspacePanelContent
						error={error}
						loadWorkspaceFile={loadWorkspaceFile}
						loading={loading}
						onSelectedPathChange={onSelectedPathChange}
						previewEmptyDescription="Choose a report, dataset, trace, or diagram to preview."
						previewEmptyTitle="Select an artifact"
						scopeLabel="artifacts"
						scopePath={scopePath}
						selectedPath={selectedPath}
						treeTestId="artifacts-tree"
						workspace={workspace}
					/>
				</div>
			)}
		</div>
	)
}
