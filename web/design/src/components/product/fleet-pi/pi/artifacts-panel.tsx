import { ChevronRight, LayoutTemplate } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types"
import type { PrimeAgentArtifact, PrimeAgentArtifactRun } from "@prime-agent/web-protocol/chat-protocol"

import { GenerativeTextRenderer } from "../../../openui/inline-renderer"
import { OpenUIHtmlArtifactView } from "../../../openui/html-artifact"
import { Button } from "../../../ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../ui/collapsible"
import { UiErrorBoundary } from "../ui-error-boundary"
import { collectSessionOpenUIBlocks } from "./artifacts-utils"
import type { SessionOpenUIBlock } from "./artifacts-utils"
import type { OpenUIHtmlArtifactPayload } from "@prime-agent/web-protocol/openui-artifact"

const DEFAULT_ARTIFACT_RUNS: Array<PrimeAgentArtifactRun> = []

type ArtifactsPanelContentProps = {
	messages: Array<ChatMessage>
	onOpenUIAction?: (message: string) => void
	status: ChatStatus
	artifactRuns?: Array<PrimeAgentArtifactRun>
	selectedArtifactId?: string | null
}

function textValue(value: unknown): string {
	if (typeof value === "string") return value
	if (value === undefined || value === null) return ""
	try {
		return JSON.stringify(value, null, 2)
	} catch {
		return String(value)
	}
}

function openUIArtifactPayload(artifact: PrimeAgentArtifact): OpenUIHtmlArtifactPayload | undefined {
	if (artifact.kind !== "openui-html") return undefined
	const output = typeof artifact.output === "object" && artifact.output !== null
		? artifact.output as Record<string, unknown>
		: undefined
	if (typeof output?.title !== "string" || typeof output.document !== "string") return undefined
	return { title: output.title, document: output.document }
}

function OpenUIArtifact({ artifact, selected }: { artifact: PrimeAgentArtifact; selected: boolean }) {
	const cardRef = useRef<HTMLElement>(null)
	useEffect(() => {
		if (!selected) return
		requestAnimationFrame(() => {
			cardRef.current?.focus({ preventScroll: true })
			cardRef.current?.scrollIntoView({ block: "nearest" })
		})
	}, [selected])
	const payload = openUIArtifactPayload(artifact)
	return (
		<article
			ref={cardRef}
			data-artifact-id={artifact.id}
			tabIndex={-1}
			className="min-w-0 rounded-md border border-border/60 bg-background p-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<div className="mb-2 flex min-w-0 items-center gap-2">
				<LayoutTemplate className="size-3.5 shrink-0 text-foreground/45" />
				<span className="min-w-0 flex-1 truncate text-xs font-medium" title={artifact.title}>
					{artifact.title || "OpenUI artifact"}
				</span>
				<span className="shrink-0 text-[10px] text-foreground/40">{artifact.status}</span>
			</div>
			{payload ? (
				<OpenUIHtmlArtifactView artifact={payload} />
			) : (
				<div role="alert" className="space-y-2 text-xs text-destructive">
					<p>OpenUI artifact data is unavailable.</p>
					<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-foreground/5 p-2 text-foreground/70">
						{textValue(artifact.output)}
					</pre>
				</div>
			)}
		</article>
	)
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
	messages,
	onOpenUIAction,
	status,
	artifactRuns = DEFAULT_ARTIFACT_RUNS,
	selectedArtifactId,
}: ArtifactsPanelContentProps) {
	const blocks = useMemo(() => collectSessionOpenUIBlocks(messages), [messages])
	const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null)
	const latestStreaming = status === "streaming" ? blocks.at(-1)?.blockId : undefined
	const openUIArtifacts = useMemo(
		() => artifactRuns.flatMap((run) => run.artifacts).filter((artifact) => artifact.kind === "openui-html"),
		[artifactRuns],
	)

	return (
		<div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
			{openUIArtifacts.length > 0 ? (
				<div className="min-h-0 flex-1 overflow-y-auto">
					<div className="mb-2 flex min-w-0 items-center gap-2 rounded-sm bg-foreground/5 px-2 py-1.5">
						<LayoutTemplate className="size-3.5 shrink-0 text-foreground/45" />
						<span className="min-w-0 flex-1 truncate text-label font-medium text-foreground/70">OpenUI artifacts</span>
						<span className="shrink-0 text-[10px] text-foreground/40">{openUIArtifacts.length}</span>
					</div>
					<div className="space-y-1">
						{openUIArtifacts.map((artifact) => (
							<OpenUIArtifact key={artifact.id} artifact={artifact} selected={artifact.id === selectedArtifactId} />
						))}
					</div>
				</div>
			) : null}
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
						re-opened without scrolling the conversation.
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
		</div>
	)
}
