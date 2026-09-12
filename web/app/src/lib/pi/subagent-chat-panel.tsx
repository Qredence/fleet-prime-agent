import { SubagentComposer } from "@prime-agent/web-design/components/product/fleet-pi/pi/subagent-composer";
import { SubagentTranscriptView } from "@prime-agent/web-design/components/product/fleet-pi/pi/subagent-transcript";
import type { PrimeAgentRlmChild } from "@prime-agent/web-protocol/chat-protocol";
import type { SubagentChatState } from "./use-subagent-chat";

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
