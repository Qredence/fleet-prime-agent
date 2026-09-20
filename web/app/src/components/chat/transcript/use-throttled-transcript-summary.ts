import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { useEffect, useMemo, useRef, useState } from "react";
import { type ChatTranscriptSummary, summarizeChatTranscript } from "@/components/sessions/transcript-summary";

export const TRANSCRIPT_SUMMARY_THROTTLE_MS = 250;

function isLiveStatus(status: ChatStatus) {
	return status === "streaming" || status === "submitted";
}

/**
 * Holds a value while a turn is live so streaming deltas do not republish
 * right-rail snapshots on every token. Identity changes and live-status edges
 * snap immediately; otherwise the snapshot updates at most once per
 * {@link TRANSCRIPT_SUMMARY_THROTTLE_MS}.
 */
export function useThrottledWhileLive<T>(value: T, status: ChatStatus, identityKey: string): T {
	const live = isLiveStatus(status);
	const valueRef = useRef(value);
	valueRef.current = value;
	const [snapshot, setSnapshot] = useState(value);
	const [seenKey, setSeenKey] = useState(identityKey);
	const [seenLive, setSeenLive] = useState(live);

	if (seenKey !== identityKey) {
		setSeenKey(identityKey);
		setSnapshot(value);
	}
	if (seenLive !== live) {
		setSeenLive(live);
		if (live) setSnapshot(value);
	}

	useEffect(() => {
		if (!live) return;
		const id = window.setInterval(() => {
			setSnapshot(valueRef.current);
		}, TRANSCRIPT_SUMMARY_THROTTLE_MS);
		return () => window.clearInterval(id);
	}, [live]);

	return live ? snapshot : value;
}

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
	const live = isLiveStatus(status);
	const messagesRef = useRef(messages);
	messagesRef.current = messages;
	const [throttled, setThrottled] = useState(() => summarizeChatTranscript(messages));
	const [seenKey, setSeenKey] = useState(transcriptKey);
	const [seenLive, setSeenLive] = useState(live);

	if (seenKey !== transcriptKey) {
		setSeenKey(transcriptKey);
		setThrottled(summarizeChatTranscript(messages));
	}
	if (seenLive !== live) {
		setSeenLive(live);
		if (live) setThrottled(summarizeChatTranscript(messages));
	}

	useEffect(() => {
		if (!live) return;
		const id = window.setInterval(() => {
			setThrottled(summarizeChatTranscript(messagesRef.current));
		}, TRANSCRIPT_SUMMARY_THROTTLE_MS);
		return () => window.clearInterval(id);
	}, [live]);

	const idleSummary = useMemo(() => summarizeChatTranscript(messages), [messages]);

	return live ? throttled : idleSummary;
}
