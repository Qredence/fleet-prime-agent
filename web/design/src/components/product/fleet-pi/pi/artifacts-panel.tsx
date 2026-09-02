import { ChevronRight, LayoutTemplate, Package } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types"
import type { PrimeAgentArtifact, PrimeAgentArtifactRun } from "@prime-agent/web-protocol/chat-protocol"

import { GenerativeTextRenderer } from "../../../openui/inline-renderer"
import { OpenUIHtmlArtifactView } from "../../../openui/html-artifact"
import { Button } from "../../../ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../ui/collapsible"
import { UiErrorBoundary } from "../ui-error-boundary"
import { CodeBlock } from "../../../registry/beui/agents/code-block"
import { FileDiff, type FileDiffStatus } from "../../../registry/beui/agents/file-diff"
import { ToolResult, ToolResultOutput, type ToolResultStatus } from "../../../registry/beui/agents/tool-result"
import { collectSessionOpenUIBlocks } from "./artifacts-utils"
import type { SessionOpenUIBlock } from "./artifacts-utils"
import { primeAgentArtifactDiff } from "./prime-agent-artifacts"
import type { OpenUIHtmlArtifactPayload } from "@prime-agent/web-protocol/openui-artifact"

const DEFAULT_ARTIFACT_RUNS: Array<PrimeAgentArtifactRun> = []

type ArtifactsPanelContentProps = {
	messages: Array<ChatMessage>
	onOpenUIAction?: (message: string) => void
	status: ChatStatus
	artifactRuns?: Array<PrimeAgentArtifactRun>
	selectedArtifactId?: string | null
}

/**
 * Converts a value to displayable text.
 *
 * @param value - The value to convert
 * @returns The original string, an empty string for `null` or `undefined`, or a JSON representation of the value
 */
function textValue(value: unknown): string {
	if (typeof value === "string") return value
	if (value === undefined || value === null) return ""
	try {
		return JSON.stringify(value, null, 2)
	} catch {
		return String(value)
	}
}

/**
 * Maps an artifact status to the corresponding tool result status.
 *
 * @param status - The artifact status to map
 * @returns The corresponding tool result status
 */
function artifactStatus(status: PrimeAgentArtifact["status"]): ToolResultStatus {
	return status === "running" ? "running" : status === "error" ? "error" : status === "cancelled" ? "cancelled" : "success"
}

/**
 * Maps an artifact status to the corresponding file-diff status.
 *
 * @param status - The artifact status to map
 * @returns The corresponding file-diff status
 */
function artifactDiffStatus(status: PrimeAgentArtifact["status"]): FileDiffStatus {
	return status === "running" ? "streaming" : status === "error" ? "error" : status === "cancelled" ? "cancelled" : "complete"
}

/**
 * Extracts displayable output sections from a value.
 *
 * @param value - The value containing output fields or content.
 * @returns Labeled output sections for display.
 */
function outputSections(value: unknown): Array<{ label: string; text: string }> {
	const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
	if (!source) return value === undefined ? [] : [{ label: "result", text: textValue(value) }]
	const sections: Array<{ label: string; text: string }> = []
	for (const label of ["stdout", "stderr", "result", "error"] as const) {
		if (source[label] === undefined || source[label] === "") continue
		sections.push({ label, text: textValue(source[label]) })
	}
	const nested = source.details ?? source.output ?? source.result
	if (sections.length === 0 && nested !== value) {
		sections.push(...outputSections(nested))
	}
	if (sections.length === 0 && Array.isArray(source.content)) {
		const text = source.content
			.flatMap((part) => {
				if (typeof part === "string") return [part]
				if (typeof part === "object" && part !== null && "text" in part && typeof part.text === "string") return [part.text]
				return []
			})
			.join("")
		if (text) sections.push({ label: source.isError === true ? "error" : "stdout", text })
	}
	if (sections.length > 0) return sections
	return [{ label: "result", text: textValue(value) }]
}

function artifactSource(artifact: PrimeAgentArtifact): { code: string; language: "bash" | "python" | "json" | "text"; label: string } | undefined {
	const input = typeof artifact.input === "object" && artifact.input !== null ? (artifact.input as Record<string, unknown>) : undefined
	const code = input?.command ?? input?.code ?? input?.script
	if (typeof code !== "string" || !code) return undefined
	if (artifact.kind === "bash") return { code, language: "bash", label: "Bash" }
	if (artifact.kind === "ipython") return { code, language: /^\s*%%bash(?:\s|$)/im.test(code) ? "bash" : "python", label: "IPython" }
	if (artifact.kind === "diff") return { code, language: "text", label: "Text" }
	return { code, language: "json", label: "JSON" }
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

/**
 * Renders a technical artifact with its source, output, or file diff details.
 *
 * @param artifact - The artifact to display.
 * @param selected - Whether the artifact is selected and should be focused and opened.
 */
function TechnicalArtifact({ artifact, selected }: { artifact: PrimeAgentArtifact; selected: boolean }) {
	const cardRef = useRef<HTMLElement>(null)
	const initiallyOpen = selected || artifact.status === "running"
	const [open, setOpen] = useState(initiallyOpen)
	useEffect(() => {
		if (!selected) return
		setOpen(true)
		requestAnimationFrame(() => {
			cardRef.current?.focus({ preventScroll: true })
			cardRef.current?.scrollIntoView({ block: "nearest" })
		})
	}, [selected])
	const source = artifactSource(artifact)
	const sections = outputSections(artifact.output)
	const diff = artifact.kind === "diff" || artifact.kind === "refinement" ? primeAgentArtifactDiff(artifact) : undefined
	return (
		<article
			ref={cardRef}
			data-artifact-id={artifact.id}
			tabIndex={-1}
			className="rounded-md border border-border/60 bg-background px-2.5 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			{diff ? (
				<>
					<FileDiff
						file={diff.file}
						lines={diff.lines}
						status={artifactDiffStatus(artifact.status)}
						defaultOpen={initiallyOpen}
						copyText={diff.copyText}
						maxHeight={240}
					/>
					{sections.map((section) => (
						<ToolResultOutput key={section.label} label={section.label} language="text">
							{section.text}
						</ToolResultOutput>
					))}
				</>
			) : null}
			{diff ? null : (
				<ToolResult
					tool={artifact.kind}
					title={artifact.title}
					status={artifactStatus(artifact.status)}
					open={open}
					onOpenChange={setOpen}
					defaultOpen={initiallyOpen}
					kind={artifact.kind === "bash" || artifact.kind === "ipython" ? "terminal" : "custom"}
				>
					<div className="space-y-3">
						{source ? (
							<CodeBlock
								code={source.code}
								language={source.language}
								languageLabel={source.label}
								showStatus={false}
								showLineNumbers={false}
								wrap
							/>
						) : null}
						{sections.map((section) => (
							<ToolResultOutput key={section.label} label={section.label} language="text">
								{section.text}
							</ToolResultOutput>
						))}
					</div>
				</ToolResult>
			)}
		</article>
	)
}

/**
 * Renders an expandable generative UI block with its component name and ordinal.
 *
 * @param block - The generative UI block to display
 * @param expanded - Whether the block content is expanded
 * @param isStreaming - Whether the block content is still streaming
 * @param onOpenUIAction - Handles actions initiated by the rendered UI
 * @param onToggle - Toggles the block's expanded state
 */
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

/**
 * Displays session-generated OpenUI, technical, and generative UI artifacts.
 *
 * @param messages - Chat messages used to collect generative UI blocks.
 * @param onOpenUIAction - Optional handler for actions triggered by rendered OpenUI content.
 * @param status - Current chat status, used to mark the latest block as streaming.
 * @param artifactRuns - Artifact runs whose artifacts are displayed in the panel.
 * @param selectedArtifactId - Identifier of the artifact to focus and scroll into view.
 */
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
	const technicalArtifacts = useMemo(() => artifactRuns.flatMap((run) => run.artifacts), [artifactRuns])
	const openUIArtifacts = useMemo(
		() => technicalArtifacts.filter((artifact) => artifact.kind === "openui-html"),
		[technicalArtifacts],
	)
	const nonOpenUIArtifacts = useMemo(
		() => technicalArtifacts.filter((artifact) => artifact.kind !== "openui-html" && artifact.kind !== "ipython"),
		[technicalArtifacts],
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
			{nonOpenUIArtifacts.length > 0 ? (
				<div className="min-h-0 flex-1 overflow-y-auto">
					<div className="mb-2 flex min-w-0 items-center gap-2 rounded-sm bg-foreground/5 px-2 py-1.5">
						<Package className="size-3.5 shrink-0 text-foreground/45" />
						<span className="min-w-0 flex-1 truncate text-label font-medium text-foreground/70">Technical artifacts</span>
						<span className="shrink-0 text-[10px] text-foreground/40">{nonOpenUIArtifacts.length}</span>
					</div>
					<div className="space-y-1">
						{nonOpenUIArtifacts.map((artifact) => (
							<TechnicalArtifact key={artifact.id} artifact={artifact} selected={artifact.id === selectedArtifactId} />
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
