import { UiErrorBoundary } from "@prime-agent/web-design/components/product/fleet-pi/ui-error-boundary"
import { FleetPiAgentChat } from "@prime-agent/web-design/components/product/fleet-pi/chat/fleet-pi-agent-chat"
import type { FleetPiAgentChatProps } from "@prime-agent/web-design/components/product/fleet-pi/chat/fleet-pi-agent-chat"
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types"
import type { PrimeAgentArtifactRun, PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol"
import type { QuestionAnswer } from "@prime-agent/web-design/components/registry/beui/agents/question/question-prompt"
import type { OpenUIArtifactCandidate } from "@prime-agent/web-design/components/openui/html-artifact"
import { useCallback, useMemo } from "react"

type ChatPanelProps = {
	messages: Array<ChatMessage>
	status: ChatStatus
	error: Error | undefined
	workspaceName?: string
	activityLabel?: string
	presentation?: PrimeAgentSessionPresentation
	artifactRuns?: Array<PrimeAgentArtifactRun>
	onOpenArtifact?: (artifactId: string) => void
	onOpenUIArtifactReady?: (candidate: OpenUIArtifactCandidate) => void | Promise<string | undefined>
	inputSuggestionItems: FleetPiAgentChatProps["suggestions"]
	suppressQuestionTool: boolean
	inputBar: FleetPiAgentChatProps["inputBar"]
	onSend: (text: string, altKey?: boolean) => void
	onOpenUIAction: (text: string) => void
	onStop: () => void
	onQuestionAnswer: (input: {
		toolCallId?: string
		answer: QuestionAnswer
	}) => void
}

export function ChatPanel({
	messages,
	status,
	error,
	workspaceName,
	activityLabel,
	presentation,
	artifactRuns,
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
			onSend(msg.content, msg.altKey)
		},
		[onSend],
	)
	const handleOpenUIAction = useCallback(
		(message: string) => {
			onOpenUIAction(message)
		},
		[onOpenUIAction],
	)
	const handleQuestionAnswer = useCallback(
		({ toolCallId, answer }: { toolCallId?: string; answer: QuestionAnswer }) => {
			void onQuestionAnswer({ toolCallId, answer })
		},
		[onQuestionAnswer],
	)
	const questionTool = useMemo(
		() => ({
			submitLabel: "Continue",
			allowSkip: true,
			onAnswer: handleQuestionAnswer,
		}),
		[handleQuestionAnswer],
	)

	return (
		<div className="contents" data-fleet-chat-focus>
		<UiErrorBoundary>
			<FleetPiAgentChat
				messages={messages}
				status={status}
				onSend={handleSend}
					onOpenUIAction={handleOpenUIAction}
					onStop={onStop}
					workspaceName={workspaceName}
					activityLabel={activityLabel}
					presentation={presentation}
					artifactRuns={artifactRuns}
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
	)
}
