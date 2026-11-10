import type { PrimeAgentArtifact } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatReasoningPart } from "@prime-agent/web-protocol/chat-types";
import type React from "react";
import { memo } from "react";
import type { ToolPartBase, ToolRendererProps } from "@/components/chat/transcript/chat-message-parts";
import { isErrorPart, isPayloadPart, isTextPart, isV5ToolPart } from "@/components/chat/transcript/chat-message-parts";
import { PayloadPart } from "@/components/chat/transcript/payload-part";
import { ReasoningLine } from "@/components/chat/transcript/reasoning-line";
import type { CustomToolRendererProps } from "@/components/chat/types";
import type { OpenUIArtifactCandidate } from "@/components/openui/html-artifact";
import { artifactDisplayTitle, toolActionIconForName, toolPartDisplayName } from "@/components/tools/tool-action-icon";
import { coerceStructuredToolPart, normalizeToolPart } from "@/components/tools/tool-output-normalizer";
import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceDescription,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from "@/components/ui/trace";
import { cn } from "@/lib/utils";

const EMPTY_NESTED_TOOLS: Array<ToolPartBase> = [];

type ErrorMessageProps = {
	title?: string;
	message: string;
	className?: string;
};

const ErrorMessage = memo(function ErrorMessage({
	title = "Unable to complete request",
	message,
	className,
}: ErrorMessageProps) {
	return (
		<div className={cn("flex justify-start", className)}>
			<div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-foreground">
				<div className="font-medium text-foreground">{title}</div>
				<div className="mt-0.5 text-muted-foreground">{message}</div>
			</div>
		</div>
	);
});

type TextRendererComponentProps = {
	content: string;
	className?: string;
	isStreaming?: boolean;
	messageId?: string;
	onOpenUIAction?: (message: string) => void;
	onOpenUIArtifactReady?: (candidate: OpenUIArtifactCandidate) => void | Promise<string | undefined>;
	onOpenArtifact?: (artifactId: string) => void;
};

function isReasoningPart(part: unknown): part is ChatReasoningPart {
	return (
		typeof part === "object" &&
		part !== null &&
		"type" in part &&
		part.type === "reasoning" &&
		"text" in part &&
		typeof part.text === "string" &&
		"contentIndex" in part &&
		typeof part.contentIndex === "number" &&
		"state" in part &&
		(part.state === "streaming" || part.state === "complete")
	);
}

/** Contiguous reasoning episodes become one collapsible. A blank line keeps each episode distinct. */
export function reasoningRunPresentation(parts: Array<ChatReasoningPart>, streaming: boolean) {
	const durations = parts.flatMap((part) => (typeof part.durationMs === "number" ? [part.durationMs] : []));
	return {
		text: parts.map((part) => part.text).join("\n\n"),
		streaming: streaming && parts.some((part) => part.state === "streaming"),
		durationMs: durations.length > 0 ? durations.reduce((total, duration) => total + duration, 0) : undefined,
	};
}

const TOOL_CALL_KEY_PREFIX = "tool-call:";
const UNKEYED_TOOL_KEY_PREFIX = "unkeyed-tool:";

/**
 * Keeps non-empty tool-call IDs authoritative while using a disjoint render-key namespace
 * for append-stable identities of unkeyed protocol fragments.
 */
export function getAssistantToolElementKey(messageId: string, part: ToolPartBase, occurrence: number) {
	if (part.toolCallId) {
		return `${TOOL_CALL_KEY_PREFIX}${part.toolCallId}`;
	}

	return `${UNKEYED_TOOL_KEY_PREFIX}${messageId}:${part.type}:${occurrence}`;
}

type BuildAssistantElementsOptions = {
	messageId: string;
	isLast: boolean;
	isStreaming: boolean;
	suppressTextWhenPlanWrite?: boolean;
	ToolRendererComponent: React.ComponentType<ToolRendererProps>;
	TextRendererComponent: React.ComponentType<TextRendererComponentProps>;
	toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>;
	onOpenUIAction?: (message: string) => void;
	onOpenUIArtifactReady?: (candidate: OpenUIArtifactCandidate) => void | Promise<string | undefined>;
	onOpenArtifact?: (artifactId: string) => void;
	artifactByToolCallId?: ReadonlyMap<string, PrimeAgentArtifact>;
	onOpenToolArtifact?: (artifactId: string, target?: "artifacts" | "repl") => void;
};

/**
 * Pure walk over (normalized) assistant parts producing the rendered element
 * list. Nested Task/Agent child tools (toolCallId "parent:child") are grouped
 * onto their parent card, tool-TaskOutput parts are suppressed, and error parts
 * become <ErrorMessage>. Text and tool parts retain their original order.
 */
export function buildAssistantElements(
	parts: Array<unknown>,
	opts: BuildAssistantElementsOptions,
): Array<React.ReactNode> {
	const {
		messageId,
		isLast,
		isStreaming,
		suppressTextWhenPlanWrite = false,
		ToolRendererComponent,
		TextRendererComponent,
		toolRenderers,
		onOpenUIAction,
		onOpenUIArtifactReady,
		onOpenArtifact,
		artifactByToolCallId,
		onOpenToolArtifact,
	} = opts;

	const elems: Array<React.ReactNode> = [];
	const textChunks: Array<string> = [];
	const hasPlanWritePresentation =
		suppressTextWhenPlanWrite && parts.some((part) => isV5ToolPart(part) && part.type === "tool-PlanWrite");
	const taskPartIds = new Set(
		parts
			.filter(
				(p): p is ToolPartBase =>
					isV5ToolPart(p) &&
					(p.type === "tool-Task" || p.type === "tool-Agent") &&
					typeof p.toolCallId === "string",
			)
			.map((p) => p.toolCallId!),
	);
	const nestedToolsMap = new Map<string, Array<ToolPartBase>>();
	const nestedToolIds = new Set<string>();
	const unkeyedToolOccurrences = new Map<string, number>();
	const reasoningRunOccurrences = new Map<string, number>();
	const payloadOccurrences = new Map<string, number>();
	const flushText = () => {
		const text = textChunks.splice(0).join("\n\n");
		if (!text) return;
		elems.push(
			<div
				key={`${messageId}-text-${elems.length}`}
				className="group/assistant-text text-body [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
			>
				<TextRendererComponent
					content={text}
					isStreaming={isStreaming}
					messageId={messageId}
					onOpenUIAction={onOpenUIAction}
					onOpenUIArtifactReady={onOpenUIArtifactReady}
					onOpenArtifact={onOpenArtifact}
					className="leading-relaxed [&_p]:leading-relaxed"
				/>
			</div>,
		);
	};

	for (const rawPart of parts) {
		if (!isV5ToolPart(rawPart)) continue;
		// Reasoning parts never render as nested tools: the main loop below
		// suppresses them, so collecting one here would leave an orphan entry
		// that delays or corrupts the parent Task trace.
		if (
			rawPart.type === "tool-TaskOutput" ||
			rawPart.type === "tool-Thinking" ||
			rawPart.type === "tool-FleetReasoning"
		) {
			continue;
		}
		if (!rawPart.toolCallId || !rawPart.toolCallId.includes(":")) continue;
		const parentId = rawPart.toolCallId.split(":")[0];
		if (!taskPartIds.has(parentId)) continue;
		if (!nestedToolsMap.has(parentId)) {
			nestedToolsMap.set(parentId, []);
		}
		nestedToolsMap.get(parentId)!.push(coerceStructuredToolPart(rawPart));
		nestedToolIds.add(rawPart.toolCallId);
	}

	let i = 0;
	while (i < parts.length) {
		const part = coerceStructuredToolPart(parts[i]!);
		if (isReasoningPart(part)) {
			flushText();
			const run = [part];
			let next = i + 1;
			while (next < parts.length) {
				const episode = parts[next];
				if (!isReasoningPart(episode)) break;
				run.push(episode);
				next++;
			}
			const presentation = reasoningRunPresentation(run, isLast && isStreaming);
			const runIdentity = String(part.contentIndex);
			const reasoningOccurrence = (reasoningRunOccurrences.get(runIdentity) ?? 0) + 1;
			reasoningRunOccurrences.set(runIdentity, reasoningOccurrence);
			elems.push(
				<ReasoningLine
					key={`${messageId}-reasoning-${runIdentity}-${reasoningOccurrence}`}
					text={presentation.text}
					streaming={presentation.streaming}
					durationMs={presentation.durationMs}
				/>,
			);
			i = next;
			continue;
		}

		if (isV5ToolPart(part) && part.type === "tool-TaskOutput") {
			i++;
			continue;
		}

		if (isTextPart(part)) {
			const text = part.text;
			if (text && !hasPlanWritePresentation) textChunks.push(text);
			i++;
			continue;
		}

		if (isErrorPart(part)) {
			flushText();
			elems.push(
				<ErrorMessage
					key={`${messageId}-error-${part.title}-${part.message}`}
					title={part.title}
					message={part.message}
				/>,
			);
			i++;
			continue;
		}

		if (isPayloadPart(part)) {
			flushText();
			const payloadIdentity = part.id ?? `${part.kind}:${part.title}`;
			const payloadOccurrence = (payloadOccurrences.get(payloadIdentity) ?? 0) + 1;
			payloadOccurrences.set(payloadIdentity, payloadOccurrence);
			elems.push(<PayloadPart key={`${messageId}-payload-${payloadIdentity}-${payloadOccurrence}`} part={part} />);
			i++;
			continue;
		}

		if (isV5ToolPart(part)) {
			if (part.type === "tool-Question" || part.type === "tool-Thinking" || part.type === "tool-FleetReasoning") {
				i++;
				continue;
			}
			if (part.toolCallId && nestedToolIds.has(part.toolCallId)) {
				i++;
				continue;
			}
			flushText();

			const state = typeof part.state === "string" ? part.state : "";
			const chatStreamingStatus =
				isLast && isStreaming && (state === "input-streaming" || state === "streaming") ? "streaming" : undefined;
			const pending = state === "input-available" || state === "pending";
			const normalized = normalizeToolPart(part, chatStreamingStatus);
			const toolLabel = toolPartDisplayName(part.type);
			const ToolIcon = toolActionIconForName(toolLabel);
			const failed = normalized?.status === "error";
			const cancelled = normalized?.status === "cancelled";
			const detailLabel = `Details for ${toolLabel}${part.toolCallId ? ` (${part.toolCallId})` : ""}`;
			const artifact = part.toolCallId ? artifactByToolCallId?.get(part.toolCallId) : undefined;
			const toolCallId = part.toolCallId;
			const nestedTools =
				(part.type === "tool-Task" || part.type === "tool-Agent") && toolCallId
					? (nestedToolsMap.get(toolCallId) ?? EMPTY_NESTED_TOOLS)
					: undefined;
			const occurrence = part.toolCallId ? 0 : (unkeyedToolOccurrences.get(part.type) ?? 0);
			if (!part.toolCallId) {
				unkeyedToolOccurrences.set(part.type, occurrence + 1);
			}

			elems.push(
				<Trace
					key={getAssistantToolElementKey(messageId, part, occurrence)}
					className="my-1 flex-row items-center"
					data-testid="assistant-tool-trace"
				>
					<TraceCollapsible
						defaultOpen={
							part.type === "tool-PlanWrite" &&
							Boolean((part.input as { pendingDecision?: unknown } | undefined)?.pendingDecision)
						}
					>
						<TraceCollapsibleTrigger aria-label={detailLabel}>
							<TraceLine
								status={failed ? "error" : chatStreamingStatus ? "running" : pending ? "pending" : undefined}
							>
								<TraceIcon>
									<ToolIcon />
								</TraceIcon>
								<TraceTitle>{toolLabel}</TraceTitle>
								{normalized?.traceDescription ? (
									<TraceDescription className="max-w-48 truncate" title={normalized.traceDescription}>
										{normalized.traceDescription}
									</TraceDescription>
								) : null}
								<TraceDescription
									className={normalized?.outputSummary.isError ? "text-destructive" : undefined}
								>
									{failed
										? "failed"
										: chatStreamingStatus
											? "running"
											: pending
												? "waiting"
												: cancelled
													? "cancelled"
													: normalized?.outputSummary.isError
														? "reported error"
														: "done"}
								</TraceDescription>
								{normalized?.durationLabel ? (
									<TraceDescription>{normalized.durationLabel}</TraceDescription>
								) : null}
							</TraceLine>
						</TraceCollapsibleTrigger>
						<TraceCollapsibleContent>
							<ToolRendererComponent
								part={part}
								nestedTools={nestedTools}
								chatStatus={chatStreamingStatus}
								toolRenderers={toolRenderers}
								insideTrace
							/>
						</TraceCollapsibleContent>
					</TraceCollapsible>
					{artifact && onOpenToolArtifact ? (
						<button
							type="button"
							className="shrink-0 text-micro underline"
							aria-label={`Open ${artifactDisplayTitle(artifact.title)} in ${artifact.kind === "ipython" ? "REPL" : "artifacts"}`}
							onClick={() => onOpenToolArtifact(artifact.id, artifact.kind === "ipython" ? "repl" : "artifacts")}
						>
							Open
						</button>
					) : null}
				</Trace>,
			);
			i++;
			continue;
		}

		i++;
	}

	flushText();

	return elems;
}
