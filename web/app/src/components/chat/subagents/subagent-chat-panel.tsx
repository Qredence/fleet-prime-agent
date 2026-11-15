import type { PrimeAgentRlmChild } from "@prime-agent/web-protocol/chat-protocol";
import { PromptInput } from "@/components/chat/composer/prompt-input";
import { SubagentTranscriptView } from "@/components/chat/subagents/subagent-transcript";
import type { SubagentChatState } from "@/hooks/chat/use-subagent-chat";

/**
 * Composer for subagent tabs, built on the same prompt input as the main
 * chat bar (auto-growing editor, Enter to send, stop control). Unlike the
 * main bar it carries no model picker, slash commands, or attachments:
 * those act on the main session, while a child turn only takes message
 * text (steered). Stays pinned below the transcript so it never scrolls
 * out of view.
 */
export function SubagentComposer({
	disabled,
	sending,
	onSend,
	onStop,
	placeholder = "Message this subagent… (Enter to steer)",
}: {
	disabled?: boolean;
	sending: boolean;
	onSend: (text: string) => void;
	onStop: () => void;
	placeholder?: string;
}) {
	return (
		<div className="shrink-0 border-t border-border/60 bg-background/80 px-4 py-3 backdrop-blur">
			<div className="mx-auto w-full max-w-3xl">
				<PromptInput
					aria-label="Message subagent"
					disabled={disabled}
					loading={sending}
					minRows={1}
					onSubmit={(value) => onSend(value)}
					onStop={onStop}
					placeholder={placeholder}
				/>
			</div>
		</div>
	);
}

/**
 * Renders the transcript view for a subagent chat with a pinned composer,
 * mirroring how the upstream agents view attaches to any agent row for an
 * interactive turn.
 *
 * @param child - The subagent whose transcript is displayed
 * @param parentSessionId - Optional identifier of the parent session
 * @param state - The subagent chat state, messaging controls, and refresh callback
 */
export function SubagentChatPanel({
	child,
	parentSessionId,
	state,
}: {
	child: PrimeAgentRlmChild;
	parentSessionId?: string;
	state: SubagentChatState & {
		refresh: () => void;
		sendMessage: (text: string) => Promise<void>;
		sending: boolean;
		stop: () => void;
	};
}) {
	const transcriptError =
		state.error ??
		(state.status === "error" ? new Error(child.error ?? "The subagent thread ended with an error.") : undefined);
	const transcriptStatus = state.loading ? "loading" : state.status === "error" || transcriptError ? "error" : "ready";
	const sendable = parentSessionId !== undefined && !state.loading;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<SubagentTranscriptView
				child={child}
				fullWidth
				parentSessionId={parentSessionId}
				status={state.status}
				transcript={{
					status: transcriptStatus,
					messages: state.messages,
					presentation: state.presentation,
					error: transcriptError,
				}}
				onRefresh={state.refresh}
			/>
			<SubagentComposer
				disabled={!sendable}
				sending={state.sending}
				onSend={(text) => void state.sendMessage(text)}
				onStop={state.stop}
			/>
		</div>
	);
}
