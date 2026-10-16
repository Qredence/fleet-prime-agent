import type React from "react";
import { memo } from "react";
import type { ToolPartBase, ToolRendererProps } from "@/components/chat/transcript/chat-message-parts";
import { isErrorPart, isPayloadPart, isTextPart, isV5ToolPart } from "@/components/chat/transcript/chat-message-parts";
import { PayloadPart } from "@/components/chat/transcript/payload-part";
import type { CustomToolRendererProps } from "@/components/chat/types";
import type { OpenUIArtifactCandidate } from "@/components/openui/html-artifact";
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
};

/**
 * Pure walk over (normalized) assistant parts producing the rendered element
 * list. Nested Task/Agent child tools (toolCallId "parent:child") are grouped
 * onto their parent card, tool-TaskOutput parts are suppressed, error parts
 * become <ErrorMessage>, and all text parts are joined into one trailing
 * markdown block.
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

			const chatStreamingStatus = isLast && isStreaming ? "streaming" : undefined;
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
				<ToolRendererComponent
					key={getAssistantToolElementKey(messageId, part, occurrence)}
					part={part}
					nestedTools={nestedTools}
					chatStatus={chatStreamingStatus}
					toolRenderers={toolRenderers}
				/>,
			);
			i++;
			continue;
		}

		i++;
	}

	const text = textChunks.join("\n\n");
	if (text) {
		elems.push(
			<div key={`${messageId}-text-final`} className="group/assistant-text text-body">
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
	}

	return elems;
}
