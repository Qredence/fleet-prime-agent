import {
	type ChatTranscriptSummary,
	summarizeChatTranscript,
} from "@prime-agent/web-design/components/product/fleet-pi/panels/transcript-summary";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { useEffect, useMemo, useRef, useState } from "react";

export const TRANSCRIPT_SUMMARY_THROTTLE_MS = 250;

/**
 * Holds the right-rail transcript snapshot while a turn is live so streaming
 * deltas do not rescan Artifacts/Insights on every token.
 *
 * Identity changes (session switch) and live-status edges snap immediately;
 * otherwise the snapshot updates at most once per {@link TRANSCRIPT_SUMMARY_THROTTLE_MS}.
 */
export function useThrottledTranscriptSummary(
	messages: Array<ChatMessage>,
	status: ChatStatus,
	transcriptKey: string,
): ChatTranscriptSummary {
	const immediate = useMemo(() => summarizeChatTranscript(messages), [messages]);
	const live = status === "streaming" || status === "submitted";
	const [throttled, setThrottled] = useState(immediate);
	const [seenKey, setSeenKey] = useState(transcriptKey);
	const [seenLive, setSeenLive] = useState(live);
	const latestRef = useRef(immediate);
	latestRef.current = immediate;

	if (seenKey !== transcriptKey) {
		setSeenKey(transcriptKey);
		setThrottled(immediate);
	}
	if (seenLive !== live) {
		setSeenLive(live);
		if (live) setThrottled(immediate);
	}

	useEffect(() => {
		if (!live) return;
		const id = window.setInterval(() => {
			setThrottled(latestRef.current);
		}, TRANSCRIPT_SUMMARY_THROTTLE_MS);
		return () => window.clearInterval(id);
	}, [live]);

	return live ? throttled : immediate;
}
