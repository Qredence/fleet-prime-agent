import type { PrimeAgentArtifactRun, PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { useCallback, useMemo } from "react";
import type { OpenUIArtifactCandidate } from "@/components/openui/html-artifact";
import type { AgentChatViewProps } from "@/components/qredence-ui/chat/agent-chat";
import { AgentChat } from "@/components/qredence-ui/chat/agent-chat";
import type { QuestionAnswer } from "@/components/qredence-ui/chat/question/question-prompt";
import { UiErrorBoundary } from "@/components/qredence-ui/layout/ui-error-boundary";
import type { QueueLane } from "@/components/qredence-ui/tools/message-queue";

type ChatPanelProps = {
	messages: Array<ChatMessage>;
	highlightedMessageId?: string;
	status: ChatStatus;
	error: Error | undefined;
	workspaceName?: string;
	activityLabel?: string;
	presentation?: PrimeAgentSessionPresentation;
	artifactRuns?: Array<PrimeAgentArtifactRun>;
	queue?: { steering: readonly string[]; followUp: readonly string[] };
	onDeleteQueuedMessage?: (lane: QueueLane, index: number, text: string) => Promise<boolean>;
	onEditQueuedMessage?: (lane: QueueLane, index: number, expectedText: string, nextText: string) => Promise<boolean>;
	onOpenArtifact?: (artifactId: string) => void;
	onOpenUIArtifactReady?: (candidate: OpenUIArtifactCandidate) => void | Promise<string | undefined>;
	inputSuggestionItems: AgentChatViewProps["suggestions"];
	suppressQuestionTool: boolean;
	inputBar: AgentChatViewProps["inputBar"];
	onSend: (text: string, altKey?: boolean) => void;
	onOpenUIAction: (text: string) => void;
	onStop: () => void;
	onQuestionAnswer: (input: { toolCallId?: string; answer: QuestionAnswer }) => void;
};

/**
 * Renders the Fleet Pi agent chat panel with workspace context, artifacts, queued messages, and interaction controls.
 *
 * @returns The chat panel UI.
 */
export function ChatPanel({
	messages,
	highlightedMessageId,
	status,
	error,
	workspaceName,
	activityLabel,
	presentation,
	artifactRuns,
	queue,
	onDeleteQueuedMessage,
	onEditQueuedMessage,
	onOpenArtifact,
	onOpenUIArtifactReady,
	inputSuggestionItems,
	suppressQuestionTool,
	inputBar,
	onSend,
	onOpenUIAction,
	onStop,
	onQuestionAnswer,
}: ChatPanelProps) {
	const handleSend = useCallback(
		(msg: { content: string; altKey?: boolean }) => {
			onSend(msg.content, msg.altKey);
		},
		[onSend],
	);
	const handleOpenUIAction = useCallback(
		(message: string) => {
			onOpenUIAction(message);
		},
		[onOpenUIAction],
	);
	const handleQuestionAnswer = useCallback(
		({ toolCallId, answer }: { toolCallId?: string; answer: QuestionAnswer }) => {
			void onQuestionAnswer({ toolCallId, answer });
		},
		[onQuestionAnswer],
	);
	const questionTool = useMemo(
		() => ({
			submitLabel: "Continue",
			allowSkip: true,
			onAnswer: handleQuestionAnswer,
		}),
		[handleQuestionAnswer],
	);

	return (
		<div className="contents" data-fleet-chat-focus>
			<UiErrorBoundary>
				<AgentChat
					messages={messages}
					highlightedMessageId={highlightedMessageId}
					status={status}
					onSend={handleSend}
					onOpenUIAction={handleOpenUIAction}
					onStop={onStop}
					workspaceName={workspaceName}
					activityLabel={activityLabel}
					presentation={presentation}
					artifactRuns={artifactRuns}
					queue={queue}
					onDeleteQueuedMessage={onDeleteQueuedMessage}
					onEditQueuedMessage={onEditQueuedMessage}
					onOpenArtifact={onOpenArtifact}
					onOpenUIArtifactReady={onOpenUIArtifactReady}
					questionTool={questionTool}
					suppressQuestionTool={suppressQuestionTool}
					error={error ?? undefined}
					emptyStatePosition="default"
					suggestions={inputSuggestionItems}
					inputBar={inputBar}
				/>
			</UiErrorBoundary>
		</div>
	);
}
