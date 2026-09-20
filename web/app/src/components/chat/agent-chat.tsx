import type {
	ChatReasoningPresentation,
	PrimeAgentArtifact,
	PrimeAgentArtifactRun,
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { AlertCircle } from "lucide-react";
import {
	type ComponentProps,
	lazy,
	memo,
	type RefObject,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getChatErrorPresentation } from "@/components/chat/chat-error-presentation";
import { ChatWelcome } from "@/components/chat/chat-welcome";
import type { InputBarProps } from "@/components/chat/composer/input-bar";
import { InputBar } from "@/components/chat/composer/input-bar";
import { SessionGenerativeTextRenderer } from "@/components/chat/generative-text-renderer";
import { type ConversationTurn, groupMessages } from "@/components/chat/transcript/conversation-turns";
import { Message, MessageBubble, MessageBubbleContent, MessageContent } from "@/components/chat/transcript/message";
import { MessageScroller } from "@/components/chat/transcript/message-scroller";
import { buildAssistantElements } from "@/components/chat/transcript/message-turns";
import { StreamingResponse } from "@/components/chat/transcript/streaming-response";
import { TurnStatus } from "@/components/chat/transcript/turn-status";
import { UserMessage } from "@/components/chat/transcript/user-message";
import {
	TRANSCRIPT_VIRTUALIZATION_THRESHOLD,
	VirtualizedTurnList,
} from "@/components/chat/transcript/virtualized-turn-list";
import type { AgentChatProps } from "@/components/chat/types";
import { CHAT_COLUMN_CLASS } from "@/components/layout/tokens";
import type { OpenUIArtifactCandidate } from "@/components/openui/html-artifact";
import type { QueueLane } from "@/components/tools/message-queue";
import { normalizeAssistantToolParts } from "@/components/tools/utils/tool-part-normalizer";
import { useUiPreferences } from "@/lib/ui-preferences";
import { cn } from "@/lib/utils";

const LazySessionToolRenderer = lazy(() =>
	import("@/components/tools/session-tool-renderer").then(({ SessionToolRenderer }) => ({
		default: SessionToolRenderer,
	})),
);

/**
 * Lazy-loaded wrapper for the session tool renderer with loading skeleton.
 *
 * @param props - Props forwarded to the SessionToolRenderer component
 * @returns Suspense-wrapped SessionToolRenderer with loading fallback
 */
function SessionToolRenderer(props: ComponentProps<typeof LazySessionToolRenderer>) {
	return (
		<Suspense
			fallback={<div className="h-7 animate-pulse rounded-md bg-muted/40" role="status" aria-label="Loading tool" />}
		>
			<LazySessionToolRenderer {...props} />
		</Suspense>
	);
}

const LazySessionReasoningPanel = lazy(() =>
	import("@/components/chat/thinking/session-reasoning-panel").then(({ SessionReasoningPanel }) => ({
		default: SessionReasoningPanel,
	})),
);

/**
 * Lazy-loaded wrapper for the session reasoning panel with loading skeleton.
 * Defers loading until first conversation turn to keep the component out of
 * the welcome route eager bundle.
 *
 * @param props - Props forwarded to the SessionReasoningPanel component
 * @returns Suspense-wrapped SessionReasoningPanel with loading fallback
 */
function SessionReasoningPanel(props: ComponentProps<typeof LazySessionReasoningPanel>) {
	return (
		<Suspense
			fallback={
				<div
					className="mb-2 h-6 animate-pulse rounded-md bg-muted/40"
					role="status"
					aria-label="Loading reasoning"
				/>
			}
		>
			<LazySessionReasoningPanel {...props} />
		</Suspense>
	);
}

const LazyToolTimeline = lazy(() =>
	import("@/components/tools/tool-timeline").then(({ ToolTimeline }) => ({
		default: ToolTimeline,
	})),
);

/**
 * Lazy-loaded wrapper for the tool timeline with loading skeleton.
 * Defers loading until first conversation turn to keep the component out of
 * the welcome route eager bundle.
 *
 * @param props - Props forwarded to the ToolTimeline component
 * @returns Suspense-wrapped ToolTimeline with loading fallback
 */
function ToolTimeline(props: ComponentProps<typeof LazyToolTimeline>) {
	return (
		<Suspense
			fallback={
				<div className="h-6 animate-pulse rounded-md bg-muted/40" role="status" aria-label="Loading timeline" />
			}
		>
			<LazyToolTimeline {...props} />
		</Suspense>
	);
}

const LazyPromptSuggestions = lazy(() =>
	import("@/components/chat/prompt-suggestions").then(({ PromptSuggestions }) => ({
		default: PromptSuggestions,
	})),
);

/**
 * Lazy-loaded wrapper for prompt suggestions with loading skeleton.
 * Defers loading until first conversation turn to keep the component out of
 * the welcome route eager bundle.
 *
 * @param props - Props forwarded to the PromptSuggestions component
 * @returns Suspense-wrapped PromptSuggestions with loading fallback
 */
function PromptSuggestions(props: ComponentProps<typeof LazyPromptSuggestions>) {
	return (
		<div className="min-h-8">
			<Suspense
				fallback={
					<div
						className="h-8 animate-pulse rounded-full bg-muted/40"
						role="status"
						aria-label="Loading suggestions"
					/>
				}
			>
				<LazyPromptSuggestions {...props} />
			</Suspense>
		</div>
	);
}

const LazyMessageQueue = lazy(() =>
	import("@/components/tools/message-queue").then(({ MessageQueue }) => ({
		default: MessageQueue,
	})),
);

/**
 * Lazy-loaded wrapper for the Fleet message queue. Defers loading until first
 * conversation turn to keep the component out of the welcome route eager bundle.
 *
 * @param props - Props forwarded to the MessageQueue component
 * @returns Suspense-wrapped MessageQueue with no loading fallback
 */
function MessageQueue(props: ComponentProps<typeof LazyMessageQueue>) {
	return (
		<Suspense fallback={null}>
			<LazyMessageQueue {...props} />
		</Suspense>
	);
}

export type AgentChatViewProps = Omit<AgentChatProps, "slots" | "toolRenderers" | "style" | "suggestions"> & {
	toolRenderers?: AgentChatProps["toolRenderers"];
	suggestions?: AgentChatProps["suggestions"];
	className?: string;
	workspaceName?: string;
	activityLabel?: string;
	presentation?: PrimeAgentSessionPresentation;
	artifactRuns?: Array<PrimeAgentArtifactRun>;
	onOpenArtifact?: (artifactId: string, target?: "artifacts" | "repl") => void;
	onOpenUIArtifactReady?: (candidate: OpenUIArtifactCandidate) => void | Promise<string | undefined>;
	queue?: { steering: readonly string[]; followUp: readonly string[] };
	onDeleteQueuedMessage?: (lane: QueueLane, index: number, text: string) => void | Promise<unknown>;
	onEditQueuedMessage?: (
		lane: QueueLane,
		index: number,
		expectedText: string,
		nextText: string,
	) => void | Promise<unknown>;
	inputBar: Omit<InputBarProps, "onSend" | "onStop" | "status" | "suggestions">;
};

/**
 * Extracts and joins the text content from a chat message's text parts.
 *
 * @param message - The chat message whose text parts are extracted
 * @returns The joined text content, separated by blank lines
 */
function textFromMessage(message: ChatMessage) {
	return (message.parts ?? [])
		.flatMap((part) => {
			if (
				typeof part === "object" &&
				part !== null &&
				"type" in part &&
				part.type === "text" &&
				"text" in part &&
				typeof part.text === "string"
			) {
				return [part.text];
			}
			return [];
		})
		.join("\n\n");
}

/**
 * Type guard that extracts a record from an unknown value.
 *
 * @param value - The value to check
 * @returns The value cast as a record if it is a plain object, otherwise undefined
 */
function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/**
 * Retrieves the most recent valid Fleet reasoning presentation from the chat messages.
 *
 * @param messages - The chat messages to inspect.
 * @returns The latest reasoning presentation, or `undefined` when none is available.
 */
function reasoningPresentationFromMessages(messages: Array<ChatMessage>): ChatReasoningPresentation | undefined {
	for (const message of [...messages].reverse()) {
		for (const part of [...(message.parts ?? [])].reverse()) {
			const source = record(part);
			if (source?.type !== "tool-FleetReasoning") continue;
			const presentation = record(source.input);
			if (
				typeof presentation?.runId !== "string" ||
				typeof presentation.phase !== "string" ||
				!Array.isArray(presentation.steps) ||
				typeof presentation.visibleSteps !== "number" ||
				typeof presentation.streaming !== "boolean" ||
				typeof presentation.startedAt !== "number" ||
				typeof presentation.restingLabel !== "string"
			) {
				continue;
			}
			return presentation as unknown as ChatReasoningPresentation;
		}
	}
	return undefined;
}

/**
 * Extracts the run identifier from an assistant message identifier.
 *
 * @param messageId - The assistant message identifier
 * @returns The run identifier, or `undefined` if the identifier does not match the expected format
 */
function runIdFromAssistantMessageId(messageId: string): string | undefined {
	const match = /^(.*)-a\d+$/.exec(messageId);
	return match?.[1];
}

/**
 * Selects artifacts associated with the current conversation turn.
 *
 * @param artifactRuns - Artifact runs to search
 * @param messages - Messages that define the current conversation turn
 * @returns Artifacts linked to the messages, their tool calls, or their assistant runs
 */
function artifactsForCurrentTurn(
	artifactRuns: Array<PrimeAgentArtifactRun> | undefined,
	messages: Array<ChatMessage>,
): Array<PrimeAgentArtifact> {
	if (!artifactRuns || messages.length === 0) return [];
	const messageIds = new Set(messages.map((message) => message.id));
	const toolCallIds = new Set(
		messages.flatMap((message) =>
			(message.parts ?? []).flatMap((part) => {
				const source = record(part);
				return typeof source?.toolCallId === "string" && source.toolCallId ? [source.toolCallId] : [];
			}),
		),
	);
	const currentRunIds = new Set(
		messages.flatMap((message) => {
			const runId = runIdFromAssistantMessageId(message.id);
			return runId ? [message.id, runId] : [message.id];
		}),
	);

	return artifactRuns
		.flatMap((run) => run.artifacts)
		.filter((artifact) => {
			if (artifact.sourceMessageId) return messageIds.has(artifact.sourceMessageId);
			if (artifact.sourceToolCallId) {
				return toolCallIds.has(artifact.sourceToolCallId) || currentRunIds.has(artifact.runId);
			}
			return currentRunIds.has(artifact.runId);
		});
}

/**
 * Renders an assistant conversation turn with its content, tool activity, reasoning, and artifacts.
 *
 * @param messages - Assistant messages belonging to the turn
 * @param isLast - Whether this is the latest conversation turn
 * @param isStreaming - Whether the assistant is currently generating a response
 * @param suppressQuestionTool - Whether to hide question-tool content
 */
function AssistantMessage({
	messages,
	isLast,
	isStreaming,
	suppressQuestionTool,
	toolRenderers,
	onOpenUIAction,
	activityLabel,
	artifactRuns,
	onOpenArtifact,
	onOpenUIArtifactReady,
	animateIn,
}: {
	messages: Array<ChatMessage>;
	isLast: boolean;
	isStreaming: boolean;
	suppressQuestionTool: boolean;
	toolRenderers?: AgentChatProps["toolRenderers"];
	onOpenUIAction?: (message: string) => void;
	activityLabel?: string;
	artifactRuns?: Array<PrimeAgentArtifactRun>;
	onOpenArtifact?: (artifactId: string, target?: "artifacts" | "repl") => void;
	onOpenUIArtifactReady?: (candidate: OpenUIArtifactCandidate) => void | Promise<string | undefined>;
	animateIn: boolean;
}) {
	const turnStreaming = isLast && isStreaming;
	const elements = useMemo(
		() =>
			messages.flatMap((message, index) =>
				buildAssistantElements(
					normalizeAssistantToolParts(
						(message.parts ?? []).filter(
							(part) => part.type !== "tool-FleetReasoning" && part.type !== "tool-Thinking",
						),
					),
					{
						messageId: message.id,
						isLast: isLast && index === messages.length - 1,
						isStreaming: turnStreaming,
						suppressQuestionTool,
						suppressTextWhenPlanWrite: true,
						ToolRendererComponent: SessionToolRenderer,
						TextRendererComponent: SessionGenerativeTextRenderer,
						toolRenderers,
						onOpenUIAction,
						onOpenUIArtifactReady,
						onOpenArtifact,
					},
				),
			),
		[
			isLast,
			turnStreaming,
			messages,
			onOpenArtifact,
			onOpenUIAction,
			onOpenUIArtifactReady,
			suppressQuestionTool,
			toolRenderers,
		],
	);
	const copyText = messages
		.flatMap((message) => {
			const text = textFromMessage(message);
			return text ? [text] : [];
		})
		.join("\n\n");
	const reasoningPresentation = useMemo(() => reasoningPresentationFromMessages(messages), [messages]);
	const timelineArtifacts = useMemo(
		() => (isLast ? artifactsForCurrentTurn(artifactRuns, messages) : []),
		[artifactRuns, isLast, messages],
	);
	const showReasoning = Boolean(reasoningPresentation);
	const showTurnStatus = isLast && !showReasoning && isLifecycleNotice(activityLabel);

	return (
		<Message from="assistant" animateIn={animateIn}>
			<MessageContent>
				<MessageBubble variant="ghost" layout={false}>
					<MessageBubbleContent>
						<div data-testid="turn-progress" className="flex flex-col gap-[var(--density-gap)]">
							{showReasoning && reasoningPresentation ? (
								<SessionReasoningPanel presentation={reasoningPresentation} />
							) : showTurnStatus ? (
								<TurnStatus label={activityLabel} />
							) : null}
							<ToolTimeline
								messages={messages}
								artifacts={timelineArtifacts}
								streaming={turnStreaming}
								onOpenArtifact={onOpenArtifact}
							/>
						</div>
						<StreamingResponse
							status={turnStreaming ? "streaming" : "complete"}
							copyText={copyText || undefined}
							announce={false}
							contentClassName="flex flex-col gap-[var(--density-gap)]"
						>
							{elements}
						</StreamingResponse>
					</MessageBubbleContent>
				</MessageBubble>
			</MessageContent>
		</Message>
	);
}

type ConversationTurnViewProps = {
	turn: ConversationTurn;
	state: {
		isLast: boolean;
		isStreaming: boolean;
		suppressQuestionTool: boolean;
	};
	rendering: {
		toolRenderers?: AgentChatProps["toolRenderers"];
		onOpenUIAction?: (message: string) => void;
		onOpenUIArtifactReady?: (candidate: OpenUIArtifactCandidate) => void | Promise<string | undefined>;
		onOpenArtifact?: (artifactId: string, target?: "artifacts" | "repl") => void;
	};
	activity: {
		label?: string;
		presentation?: PrimeAgentSessionPresentation;
		artifactRuns?: Array<PrimeAgentArtifactRun>;
	};
	/** True when the parent list is windowing rows; skip content-visibility there. */
	windowed?: boolean;
	/** First-appearance entrance. Recycled virtualized rows should pass false. */
	animateIn?: boolean;
	highlightedMessageId?: string;
};

/**
 * Checks if two message arrays contain identical message references.
 *
 * @param previous - The previous message array
 * @param next - The next message array
 * @returns True if both arrays have the same length and identical message references
 */
function sameMessages(previous: Array<ChatMessage>, next: Array<ChatMessage>) {
	return previous.length === next.length && previous.every((message, index) => message === next[index]);
}

export const ConversationTurnView = memo(
	function ConversationTurnView({
		turn,
		state,
		rendering,
		activity,
		windowed = false,
		animateIn,
		highlightedMessageId,
	}: ConversationTurnViewProps) {
		const shouldAnimate = animateIn ?? !state.isStreaming;
		const isHighlighted =
			(highlightedMessageId &&
				(turn.user?.id === highlightedMessageId ||
					turn.assistants.some((message) => message.id === highlightedMessageId))) ||
			false;
		return (
			<div
				className={cn(
					"flex flex-col gap-[var(--density-gap)] rounded-lg transition-colors",
					isHighlighted ? "bg-foreground/6 ring-1 ring-foreground/15" : undefined,
				)}
				style={windowed ? undefined : { contentVisibility: "auto", containIntrinsicSize: "auto 400px" }}
			>
				{turn.user ? (
					<Message from="user" animateIn={shouldAnimate}>
						<MessageContent>
							<UserMessage message={turn.user} />
						</MessageContent>
					</Message>
				) : null}
				{turn.assistants.length > 0 ? (
					<AssistantMessage
						messages={turn.assistants}
						isLast={state.isLast}
						isStreaming={state.isStreaming}
						suppressQuestionTool={state.suppressQuestionTool}
						toolRenderers={rendering.toolRenderers}
						onOpenUIAction={rendering.onOpenUIAction}
						onOpenUIArtifactReady={rendering.onOpenUIArtifactReady}
						onOpenArtifact={rendering.onOpenArtifact}
						activityLabel={activity.label}
						artifactRuns={activity.artifactRuns}
						animateIn={shouldAnimate}
					/>
				) : null}
			</div>
		);
	},
	(previous, next) =>
		previous.turn.user === next.turn.user &&
		sameMessages(previous.turn.assistants, next.turn.assistants) &&
		previous.state.isLast === next.state.isLast &&
		previous.state.isStreaming === next.state.isStreaming &&
		previous.state.suppressQuestionTool === next.state.suppressQuestionTool &&
		previous.rendering.toolRenderers === next.rendering.toolRenderers &&
		previous.rendering.onOpenUIAction === next.rendering.onOpenUIAction &&
		previous.rendering.onOpenUIArtifactReady === next.rendering.onOpenUIArtifactReady &&
		previous.rendering.onOpenArtifact === next.rendering.onOpenArtifact &&
		previous.activity.label === next.activity.label &&
		previous.activity.presentation === next.activity.presentation &&
		previous.activity.artifactRuns === next.activity.artifactRuns &&
		previous.windowed === next.windowed &&
		previous.animateIn === next.animateIn &&
		previous.highlightedMessageId === next.highlightedMessageId,
);

/**
 * Determines if an activity label indicates a lifecycle event rather than
 * content generation.
 *
 * @param label - The activity label to check
 * @returns True if the label matches a lifecycle event pattern
 */
function isLifecycleNotice(label: string | undefined) {
	if (!label) return false;
	return /queued|steered|retry|compact|reset|recover|sign in/i.test(label);
}

/**
 * Resolves suggestions from either an array or an object containing suggestion items.
 *
 * @param suggestions - The suggestions to normalize.
 * @returns The available suggestions as an array.
 */
function resolveSuggestions(suggestions: AgentChatViewProps["suggestions"]) {
	if (Array.isArray(suggestions)) return suggestions;
	return suggestions?.items ?? [];
}

/**
 * Owns the composer draft state so that keystrokes re-render only the input
 * bar instead of the whole chat (including the MessageScroller subtree).
 * Suggestion clicks reach the draft via `draftSetterRef`. The composer always
 * mounts as sticky chrome below the scroller (welcome and active session share
 * one host), and the draft is cleared on send.
 */
function ChatComposerHost({
	inputBar,
	status,
	suggestions,
	onSend,
	onStop,
	isEmpty,
	draftSetterRef,
}: {
	inputBar: AgentChatViewProps["inputBar"];
	status: AgentChatViewProps["status"];
	suggestions: AgentChatViewProps["suggestions"];
	onSend: AgentChatViewProps["onSend"];
	onStop: AgentChatViewProps["onStop"];
	isEmpty: boolean;
	draftSetterRef: RefObject<((value: string) => void) | null>;
}) {
	const [draft, setDraft] = useState("");
	useEffect(() => {
		draftSetterRef.current = setDraft;
	}, [draftSetterRef]);
	return (
		<InputBar
			{...inputBar}
			className={inputBar.className}
			placeholder={isEmpty ? "Ask Prime to build, investigate, or change something…" : inputBar.placeholder}
			controlled={{ value: draft, onChange: setDraft }}
			status={status}
			suggestions={suggestions}
			onSend={onSend}
			onStop={onStop}
		/>
	);
}

const MemoChatComposerHost = memo(ChatComposerHost);

/**
 * Stable key for a conversation turn. Assistant-only turns have no user
 * message, so fall back to the first assistant message id before the index:
 * an index-only fallback shifts keys when a turn is prepended.
 *
 * @param turn - The conversation turn to key
 * @param turnIndex - Positional fallback used only when the turn has no message ids
 * @returns The stable key for the turn
 */
function getConversationTurnKey(turn: ConversationTurn, turnIndex: number) {
	return turn.user?.id ?? turn.assistants[0]?.id ?? `assistant-turn-${turnIndex}`;
}

/**
 * Renders the Fleet Prime Agent chat interface with conversation turns, activity, suggestions, errors, and message input.
 *
 * @param messages - Conversation messages to display.
 * @param status - Current chat request status.
 * @param suggestions - Optional prompts shown after a completed conversation.
 * @param artifactRuns - Artifact runs associated with the current conversation turn.
 * @returns The Fleet Prime Agent chat interface.
 */
export function AgentChat({
	toolRenderers,
	suggestions,
	status,
	onStop,
	onSend,
	inputBar,
	className,
	messages,
	error,
	suppressQuestionTool = false,
	onOpenUIAction,
	activityLabel,
	presentation,
	artifactRuns,
	onOpenArtifact,
	onOpenUIArtifactReady,
	queue,
	onDeleteQueuedMessage,
	onEditQueuedMessage,
	highlightedMessageId,
}: AgentChatViewProps) {
	const draftSetterRef = useRef<((value: string) => void) | null>(null);
	const viewportRef = useRef<HTMLElement | null>(null);
	const seenTurnKeysRef = useRef(new Set<string>());
	const { transcript } = useUiPreferences();
	const setDraft = useCallback((value: string) => draftSetterRef.current?.(value), []);
	const turns = useMemo(() => groupMessages(messages), [messages]);
	const suggestionItems = resolveSuggestions(suggestions);
	const suggestionTexts = useMemo(
		() => suggestionItems.flatMap((item) => (item.disabled ? [] : [item.value ?? item.label])),
		[suggestionItems],
	);
	const suggestionCycle = suggestionTexts.join("\u0000");
	const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null);
	const [prevSuggestionCycle, setPrevSuggestionCycle] = useState(suggestionCycle);
	if (prevSuggestionCycle !== suggestionCycle) {
		setPrevSuggestionCycle(suggestionCycle);
		setSelectedSuggestion(null);
	}
	const isStreaming = status === "streaming" || status === "submitted";
	const rendering = useMemo<ConversationTurnViewProps["rendering"]>(
		() => ({ toolRenderers, onOpenUIAction, onOpenUIArtifactReady, onOpenArtifact }),
		[onOpenArtifact, onOpenUIAction, onOpenUIArtifactReady, toolRenderers],
	);
	const stateForLast = useMemo<ConversationTurnViewProps["state"]>(
		() => ({ isLast: true, isStreaming, suppressQuestionTool }),
		[isStreaming, suppressQuestionTool],
	);
	const stateForRest = useMemo<ConversationTurnViewProps["state"]>(
		() => ({ isLast: false, isStreaming: false, suppressQuestionTool }),
		[suppressQuestionTool],
	);
	const activityForLast = useMemo<ConversationTurnViewProps["activity"]>(
		() => ({ label: activityLabel, presentation, artifactRuns }),
		[activityLabel, artifactRuns, presentation],
	);
	const activityForRest = useMemo<ConversationTurnViewProps["activity"]>(
		() => ({ label: undefined, presentation: undefined, artifactRuns: undefined }),
		[],
	);
	const windowed = turns.length >= TRANSCRIPT_VIRTUALIZATION_THRESHOLD;
	if (turns.length === 0 && seenTurnKeysRef.current.size > 0) {
		seenTurnKeysRef.current.clear();
	}
	const renderTurn = useCallback(
		(turn: ConversationTurn, turnIndex: number) => {
			const isLast = turnIndex === turns.length - 1;
			const key = getConversationTurnKey(turn, turnIndex);
			const firstAppearance = !seenTurnKeysRef.current.has(key);
			if (firstAppearance) seenTurnKeysRef.current.add(key);
			return (
				<ConversationTurnView
					turn={turn}
					state={isLast ? stateForLast : stateForRest}
					rendering={rendering}
					activity={isLast ? activityForLast : activityForRest}
					windowed={windowed}
					animateIn={firstAppearance && !(isLast && isStreaming)}
					highlightedMessageId={highlightedMessageId}
				/>
			);
		},
		[
			activityForLast,
			activityForRest,
			highlightedMessageId,
			isStreaming,
			rendering,
			stateForLast,
			stateForRest,
			turns.length,
			windowed,
		],
	);
	const isEmpty = turns.length === 0 && !error;
	const errorPresentation = error ? getChatErrorPresentation(error) : null;
	const composerNode = (
		<MemoChatComposerHost
			inputBar={inputBar}
			status={status}
			suggestions={suggestions}
			onSend={onSend}
			onStop={onStop}
			isEmpty={isEmpty}
			draftSetterRef={draftSetterRef}
		/>
	);

	return (
		<div className={cn("agent-chat flex h-full min-h-0 flex-col bg-background", className)}>
			<MessageScroller
				className="flex-1"
				busy={isStreaming}
				followOutput={transcript === "follow"}
				viewportRef={viewportRef}
				smooth={!isStreaming}
				contentClassName={cn(
					CHAT_COLUMN_CLASS,
					"flex flex-col gap-[var(--density-gap)]",
					isEmpty ? "min-h-full items-center justify-center py-8" : "py-6",
				)}
			>
				{isEmpty ? (
					<ChatWelcome disabled={isStreaming} onSelect={(item) => setDraft(item.value ?? item.label)} />
				) : null}
				<VirtualizedTurnList
					estimateSize={400}
					getItemKey={getConversationTurnKey}
					itemGap={20}
					items={turns}
					renderItem={renderTurn}
					viewportRef={viewportRef}
				/>
				{errorPresentation ? (
					<div
						role="alert"
						className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
					>
						<AlertCircle className="mt-0.5 size-4 shrink-0" />
						<div>
							<p className="font-medium">{errorPresentation.title}</p>
							<p className="mt-1 text-xs opacity-90">{errorPresentation.message}</p>
						</div>
					</div>
				) : null}
				{turns.length > 0 && suggestionTexts.length > 0 && !isStreaming && !error ? (
					<PromptSuggestions
						suggestions={suggestionTexts}
						selectedSuggestion={selectedSuggestion}
						cycle={turns.length}
						onSuggestion={(suggestion) => {
							setSelectedSuggestion(suggestion);
							setDraft(suggestion);
						}}
						className="px-0"
					/>
				) : null}
			</MessageScroller>
			{composerNode}
			{queue && (queue.steering.length > 0 || queue.followUp.length > 0) ? (
				<MessageQueue queue={queue} onDelete={onDeleteQueuedMessage} onEdit={onEditQueuedMessage} />
			) : null}
		</div>
	);
}
