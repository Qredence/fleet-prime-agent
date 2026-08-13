import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

const SCROLL_THRESHOLD = 80;

export type UseChatAutoScrollOptions = {
	/**
	 * Read only by the mount-time layout effect (stale closure by design, same
	 * as the pre-extraction component): changing it after mount has no effect.
	 */
	initialScrollBehavior: "bottom" | "top";
	/** Initial value for the last-message ref, from the raw messages array. */
	initialLastMessageId: string | null;
	lastUserMessageId: string | null;
	showPlanning: boolean;
	lastMessageId: string | null;
	lastMessageRole: string | null;
};

/**
 * Owns the chat transcript's scroll behavior: container/content refs, the two
 * ResizeObservers (container height CSS var + content growth delta
 * compensation), the auto-scroll pin/release logic, the rAF settle chain, and
 * the "new user message forces scroll to bottom" / planning-scroll effects.
 *
 * Extracted from message-list.tsx with semantics unchanged.
 */
export function useChatAutoScroll({
	initialScrollBehavior,
	initialLastMessageId,
	lastUserMessageId,
	showPlanning,
	lastMessageId,
	lastMessageRole,
}: UseChatAutoScrollOptions) {
	const chatContainerRef = useRef<HTMLDivElement>(null);
	const contentWrapperRef = useRef<HTMLDivElement>(null);
	const shouldAutoScrollRef = useRef(true);
	const prevScrollTopRef = useRef(0);
	const lastMessageIdRef = useRef<string | null>(initialLastMessageId);
	const assistantSpaceActiveRef = useRef(false);
	const lastUserMessageIdRef = useRef(lastUserMessageId);
	const pendingPlanningScrollUserIdRef = useRef<string | null>(null);

	const containerRefCallback = useCallback((el: HTMLDivElement | null) => {
		chatContainerRef.current = el;
	}, []);

	useEffect(() => {
		const container = chatContainerRef.current;
		if (!container) return;
		container.style.setProperty("--chat-container-height", `${container.clientHeight}px`);
		const observer = new ResizeObserver((entries) => {
			const height = entries[0]?.contentRect.height ?? 0;
			container.style.setProperty("--chat-container-height", `${height}px`);
		});
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	const scrollToBottomInstant = useCallback(() => {
		const container = chatContainerRef.current;
		if (!container) return;
		container.scrollTop = container.scrollHeight;
	}, []);

	const scrollToBottomSettled = useCallback(() => {
		let rafOne = 0;
		let rafTwo = 0;
		scrollToBottomInstant();
		rafOne = requestAnimationFrame(() => {
			scrollToBottomInstant();
			rafTwo = requestAnimationFrame(() => {
				scrollToBottomInstant();
			});
		});
		return () => {
			cancelAnimationFrame(rafOne);
			cancelAnimationFrame(rafTwo);
		};
	}, [scrollToBottomInstant]);

	const isAtBottom = useCallback(() => {
		const container = chatContainerRef.current;
		if (!container) return true;
		return container.scrollHeight - container.scrollTop - container.clientHeight < SCROLL_THRESHOLD;
	}, []);

	const handleScroll = useCallback(() => {
		const container = chatContainerRef.current;
		if (!container) return;

		const currentScrollTop = container.scrollTop;
		const prevScrollTop = prevScrollTopRef.current;
		prevScrollTopRef.current = currentScrollTop;

		if (currentScrollTop < prevScrollTop) {
			shouldAutoScrollRef.current = false;
			return;
		}
		shouldAutoScrollRef.current = isAtBottom();
	}, [isAtBottom]);

	useLayoutEffect(() => {
		const container = chatContainerRef.current;
		const contentWrapper = contentWrapperRef.current;
		if (!container || !contentWrapper) return;

		if (initialScrollBehavior === "top") {
			container.scrollTop = 0;
			shouldAutoScrollRef.current = false;
		} else {
			container.scrollTop = container.scrollHeight;
			shouldAutoScrollRef.current = true;
		}

		let lastContentHeight = contentWrapper.getBoundingClientRect().height;
		let prevScrollHeight = container.scrollHeight;

		const resizeObserver = new ResizeObserver(() => {
			const newContentHeight = contentWrapper.getBoundingClientRect().height;
			if (newContentHeight === lastContentHeight) return;
			lastContentHeight = newContentHeight;

			if (!shouldAutoScrollRef.current) {
				const newScrollHeight = container.scrollHeight;
				if (newScrollHeight !== prevScrollHeight && prevScrollHeight > 0) {
					const delta = newScrollHeight - prevScrollHeight;
					container.scrollTop = container.scrollTop + delta;
				}
			}
			prevScrollHeight = container.scrollHeight;
		});

		resizeObserver.observe(contentWrapper);
		return () => resizeObserver.disconnect();
	}, [initialScrollBehavior]);

	useLayoutEffect(() => {
		if (lastUserMessageId && lastUserMessageId !== lastUserMessageIdRef.current) {
			shouldAutoScrollRef.current = true;
			pendingPlanningScrollUserIdRef.current = lastUserMessageId;
			const cancel = scrollToBottomSettled();
			lastUserMessageIdRef.current = lastUserMessageId;
			return cancel;
		}
	}, [lastUserMessageId, scrollToBottomSettled]);

	useEffect(() => {
		if (lastMessageRole === "assistant") {
			if (lastMessageId && lastMessageId !== lastMessageIdRef.current) {
				assistantSpaceActiveRef.current = true;
			}
		}
		if (lastMessageRole === "user") {
			assistantSpaceActiveRef.current = false;
		}
		lastMessageIdRef.current = lastMessageId;
	}, [lastMessageId, lastMessageRole]);

	useLayoutEffect(() => {
		if (!showPlanning || !lastUserMessageId) return;
		if (pendingPlanningScrollUserIdRef.current !== lastUserMessageId) return;
		const cancel = scrollToBottomSettled();
		pendingPlanningScrollUserIdRef.current = null;
		return cancel;
	}, [lastUserMessageId, showPlanning, scrollToBottomSettled]);

	return {
		containerRefCallback,
		contentWrapperRef,
		handleScroll,
		assistantSpaceActiveRef,
		lastMessageIdRef,
	};
}
