import type { PrimeAgentArtifact } from "@prime-agent/web-protocol/chat-protocol";
import type React from "react";
import { memo } from "react";
import type { ToolPartBase, ToolRendererProps } from "@/components/chat/transcript/chat-message-parts";
import { isErrorPart, isPayloadPart, isTextPart, isV5ToolPart } from "@/components/chat/transcript/chat-message-parts";
import { PayloadPart } from "@/components/chat/transcript/payload-part";
import { ReasoningLine } from "@/components/chat/transcript/reasoning-line";
import type { CustomToolRendererProps } from "@/components/chat/types";
import type { OpenUIArtifactCandidate } from "@/components/openui/html-artifact";
import { toolActionIconForName } from "@/components/tools/tool-action-icon";
import { normalizeToolPart } from "@/components/tools/tool-output-normalizer";
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
	suppressQuestionTool: boolean;
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
		suppressQuestionTool,
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

	for (const part of parts) {
		if (!isV5ToolPart(part)) continue;
		if (part.type === "tool-TaskOutput") continue;
		if (!part.toolCallId || !part.toolCallId.includes(":")) continue;
		const parentId = part.toolCallId.split(":")[0];
		if (!taskPartIds.has(parentId)) continue;
		if (!nestedToolsMap.has(parentId)) {
			nestedToolsMap.set(parentId, []);
		}
		nestedToolsMap.get(parentId)!.push(part);
		nestedToolIds.add(part.toolCallId);
	}

	let i = 0;
	while (i < parts.length) {
		const part = parts[i]!;
		if (
			typeof part === "object" &&
			part !== null &&
			"type" in part &&
			part.type === "reasoning" &&
			"text" in part &&
			typeof part.text === "string" &&
			"contentIndex" in part &&
			typeof part.contentIndex === "number" &&
			"state" in part &&
			typeof part.state === "string"
		) {
			flushText();
			elems.push(
				<ReasoningLine
					key={`${messageId}-reasoning-${part.contentIndex}`}
					text={part.text}
					streaming={isLast && isStreaming && part.state === "streaming"}
					durationMs={"durationMs" in part && typeof part.durationMs === "number" ? part.durationMs : undefined}
				/>,
			);
			i++;
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
			elems.push(<PayloadPart key={`${messageId}-payload-${i}`} part={part} />);
			i++;
			continue;
		}

		if (isV5ToolPart(part)) {
			if (suppressQuestionTool && part.type === "tool-Question") {
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
			const ToolIcon = toolActionIconForName(part.type.replace(/^tool-/, ""));
			const failed = normalized?.status === "error";
			const cancelled = normalized?.status === "cancelled";
			const detailLabel = `Details for ${part.type.replace(/^tool-/, "")}${part.toolCallId ? ` (${part.toolCallId})` : ""}`;
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
							part.type === "tool-Question" ||
							(part.type === "tool-PlanWrite" &&
								Boolean((part.input as { pendingDecision?: unknown } | undefined)?.pendingDecision))
						}
					>
						<TraceCollapsibleTrigger aria-label={detailLabel}>
							<TraceLine
								status={failed ? "error" : chatStreamingStatus ? "running" : pending ? "pending" : undefined}
							>
								<TraceIcon>
									<ToolIcon />
								</TraceIcon>
								<TraceTitle>{part.type.replace(/^tool-/, "")}</TraceTitle>
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
							aria-label={`Open ${artifact.title} in ${artifact.kind === "ipython" ? "REPL" : "artifacts"}`}
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
