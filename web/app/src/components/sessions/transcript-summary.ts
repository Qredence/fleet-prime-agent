import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { collectSessionOpenUIBlocks, type SessionOpenUIBlock } from "@/components/artifacts/artifacts-utils";

export type ChatTranscriptSummary = {
	assistantMessageCount: number;
	openUIBlocks: Array<SessionOpenUIBlock>;
	userMessageCount: number;
};

export const EMPTY_CHAT_TRANSCRIPT_SUMMARY: ChatTranscriptSummary = {
	assistantMessageCount: 0,
	openUIBlocks: [],
	userMessageCount: 0,
};

/**
 * Derives the throttled right-rail snapshot from a transcript. Counts and
 * OpenUI blocks are the only fields panels need; the raw message array stays
 * out of panel context so streaming deltas do not rescan the rail.
 */
export function summarizeChatTranscript(messages: ReadonlyArray<ChatMessage>): ChatTranscriptSummary {
	let assistantMessageCount = 0;
	let userMessageCount = 0;
	for (const message of messages) {
		if (message.role === "assistant") assistantMessageCount += 1;
		else userMessageCount += 1;
	}
	return {
		assistantMessageCount,
		openUIBlocks: collectSessionOpenUIBlocks(messages),
		userMessageCount,
	};
}
