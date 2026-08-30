import type { PreviewRailItem } from "@prime-agent/web-design/components/registry/beui/motion/preview-rail";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

const PREVIEW_TITLE_LENGTH = 56;
const PREVIEW_DESCRIPTION_LENGTH = 88;

function truncateMessageText(text: string, limit: number) {
	if (text.length <= limit) return text;
	const excerpt = text.slice(0, limit);
	const boundary = excerpt.lastIndexOf(" ");
	return `${excerpt.slice(0, boundary > limit * 0.65 ? boundary : limit).trim()}…`;
}

function getMessageText(message: HTMLElement) {
	const surface =
		message.querySelector<HTMLElement>('[data-slot="message-bubble-content"]') ??
		message.querySelector<HTMLElement>('[data-slot="message-content"]') ??
		message;
	return (surface.textContent ?? "").replace(/\s+/g, " ").trim();
}

function getMessagePreview(message: HTMLElement, assistantResponse?: HTMLElement) {
	const text = getMessageText(message);
	if (!text) return { label: "Message", description: undefined };

	if (text.length <= PREVIEW_TITLE_LENGTH) {
		const responseText = assistantResponse ? getMessageText(assistantResponse) : "";
		return {
			label: text,
			description: responseText ? truncateMessageText(responseText, PREVIEW_DESCRIPTION_LENGTH) : undefined,
		};
	}

	const titleExcerpt = text.slice(0, PREVIEW_TITLE_LENGTH);
	const titleBoundary = titleExcerpt.lastIndexOf(" ");
	const titleEnd = titleBoundary > PREVIEW_TITLE_LENGTH * 0.65 ? titleBoundary : PREVIEW_TITLE_LENGTH;
	const label = `${text.slice(0, titleEnd).trim()}…`;
	const responseText = assistantResponse ? getMessageText(assistantResponse) : text.slice(titleEnd).trim();
	return {
		label,
		description: responseText ? truncateMessageText(responseText, PREVIEW_DESCRIPTION_LENGTH) : undefined,
	};
}

export interface MessageScrollerRailOptions {
	navigation?: "rail";
	followThreshold: number;
	contentRef: RefObject<HTMLDivElement | null>;
	viewportRef: RefObject<HTMLElement | null>;
	reduce: boolean;
	smooth: boolean;
	scrollToEnd: (behavior: ScrollBehavior) => void;
	setFollowing: (following: boolean) => void;
	markProgrammaticScroll: (behavior: ScrollBehavior) => void;
}

export function useMessageScrollerRail({
	navigation,
	followThreshold,
	contentRef,
	viewportRef,
	reduce,
	smooth,
	scrollToEnd,
	setFollowing,
	markProgrammaticScroll,
}: MessageScrollerRailOptions) {
	const railFrameRef = useRef<number | undefined>(undefined);
	const railIdRef = useRef(new WeakMap<HTMLElement, string>());
	const railIdCounterRef = useRef(0);
	const railTargetsRef = useRef(new Map<string, HTMLElement>());
	const [railItems, setRailItems] = useState<PreviewRailItem[]>([]);
	const [activeRailId, setActiveRailId] = useState("");
	const [railOverflowing, setRailOverflowing] = useState(false);

	const updateActiveRailItem = useCallback(() => {
		if (navigation !== "rail") return;
		const viewport = viewportRef.current;
		const targets = [...railTargetsRef.current.entries()];
		if (!viewport || targets.length === 0) return;

		const viewportRect = viewport.getBoundingClientRect();
		if (viewport.scrollTop <= followThreshold) {
			const firstId = targets[0]?.[0] ?? "";
			setActiveRailId((current) => (current === firstId ? current : firstId));
			return;
		}

		const distanceFromEnd = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
		if (distanceFromEnd <= followThreshold) {
			const lastId = targets.at(-1)?.[0] ?? "";
			setActiveRailId((current) => (current === lastId ? current : lastId));
			return;
		}

		const viewportCenter = viewportRect.top + viewportRect.height / 2;
		let nearestId = targets[0]?.[0] ?? "";
		let nearestDistance = Number.POSITIVE_INFINITY;
		for (const [id, element] of targets) {
			const rect = element.getBoundingClientRect();
			const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearestId = id;
			}
		}
		setActiveRailId((current) => (current === nearestId ? current : nearestId));
	}, [followThreshold, navigation, viewportRef]);

	const syncRailItems = useCallback(() => {
		if (navigation !== "rail") return;
		const content = contentRef.current;
		const viewport = viewportRef.current;
		if (!content || !viewport) return;

		const messages = Array.from(content.querySelectorAll<HTMLElement>('[data-slot="message"]'));
		const targets = new Map<string, HTMLElement>();
		const nextItems = messages.map((message, index) => {
			let id = railIdRef.current.get(message);
			if (!id) {
				railIdCounterRef.current += 1;
				id = `message-rail-${railIdCounterRef.current}`;
				railIdRef.current.set(message, id);
			}
			targets.set(id, message);
			const sender = message.dataset.from ?? "conversation";
			const assistantResponse =
				sender === "user"
					? messages.slice(index + 1).find((candidate) => candidate.dataset.from === "assistant")
					: undefined;
			const preview = getMessagePreview(message, assistantResponse);
			return {
				id,
				label: preview.label,
				description: preview.description,
				ariaLabel: `Go to ${sender} message ${index + 1} of ${messages.length}`,
			};
		});

		railTargetsRef.current = targets;
		setRailItems((current) => {
			const unchanged =
				current.length === nextItems.length &&
				current.every(
					(item, index) =>
						item.id === nextItems[index]?.id &&
						item.label === nextItems[index]?.label &&
						item.description === nextItems[index]?.description &&
						item.ariaLabel === nextItems[index]?.ariaLabel,
				);
			return unchanged ? current : nextItems;
		});
		setRailOverflowing(viewport.scrollHeight > viewport.clientHeight + 1 && messages.length > 1);
	}, [contentRef, navigation, viewportRef]);

	const scheduleRailSync = useCallback(() => {
		if (navigation !== "rail") return;
		if (railFrameRef.current) cancelAnimationFrame(railFrameRef.current);
		railFrameRef.current = requestAnimationFrame(() => {
			syncRailItems();
			updateActiveRailItem();
		});
	}, [navigation, syncRailItems, updateActiveRailItem]);

	useEffect(() => {
		if (navigation !== "rail") {
			railTargetsRef.current.clear();
			setRailItems([]);
			setRailOverflowing(false);
			return;
		}

		const content = contentRef.current;
		const viewport = viewportRef.current;
		if (!content || !viewport) return;

		scheduleRailSync();
		const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(scheduleRailSync);
		mutationObserver?.observe(content, {
			childList: true,
			characterData: true,
			subtree: true,
		});

		const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleRailSync);
		resizeObserver?.observe(content);
		resizeObserver?.observe(viewport);

		return () => {
			mutationObserver?.disconnect();
			resizeObserver?.disconnect();
		};
	}, [contentRef, navigation, scheduleRailSync, viewportRef]);

	useEffect(
		() => () => {
			if (railFrameRef.current) cancelAnimationFrame(railFrameRef.current);
		},
		[],
	);

	const scrollToRailItem = useCallback(
		(item: PreviewRailItem) => {
			const viewport = viewportRef.current;
			const target = railTargetsRef.current.get(item.id);
			if (!viewport || !target) return;

			const lastItem = railItems.at(-1)?.id === item.id;
			setActiveRailId(item.id);
			if (lastItem) {
				setFollowing(true);
				scrollToEnd(reduce || !smooth ? "auto" : "smooth");
				return;
			}

			setFollowing(false);
			markProgrammaticScroll(reduce || !smooth ? "auto" : "smooth");
			const viewportRect = viewport.getBoundingClientRect();
			const targetRect = target.getBoundingClientRect();
			const top =
				viewport.scrollTop + targetRect.top - viewportRect.top - (viewport.clientHeight - targetRect.height) / 2;
			const behavior = reduce || !smooth ? "auto" : "smooth";
			if (typeof viewport.scrollTo === "function") {
				viewport.scrollTo({ top, behavior });
			} else {
				viewport.scrollTop = top;
			}
		},
		[markProgrammaticScroll, railItems, reduce, scrollToEnd, setFollowing, smooth, viewportRef],
	);

	return {
		activeRailId,
		railItems,
		railOverflowing,
		scheduleRailSync,
		scrollToRailItem,
	};
}
