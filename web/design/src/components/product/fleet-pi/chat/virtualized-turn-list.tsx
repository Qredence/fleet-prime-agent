import {
	Fragment,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

export const TRANSCRIPT_VIRTUALIZATION_THRESHOLD = 40;

type VirtualizedTurnListProps<T> = {
	estimateSize: number;
	getItemKey: (item: T, index: number) => string;
	itemGap?: number;
	items: readonly T[];
	overscan?: number;
	renderItem: (item: T, index: number) => ReactNode;
	viewportRef: RefObject<HTMLElement | null>;
};

type ViewportState = {
	height: number;
	scrollTop: number;
};

function findItemAtOffset(offsets: readonly number[], target: number, itemCount: number) {
	if (itemCount === 0) return 0;

	let low = 0;
	let high = itemCount;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (offsets[middle] <= target) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return Math.max(0, Math.min(itemCount - 1, low - 1));
}

function buildOffsets(
	itemKeys: readonly string[],
	measuredHeights: ReadonlyMap<string, number>,
	estimateSize: number,
	itemGap: number,
) {
	const offsets = [0];
	for (const [index, key] of itemKeys.entries()) {
		offsets.push(
			offsets[offsets.length - 1] +
				(measuredHeights.get(key) ?? estimateSize) +
				(index < itemKeys.length - 1 ? itemGap : 0),
		);
	}
	return offsets;
}

/**
 * Renders short transcripts normally and windows long transcripts around the
 * visible scroll range. Row heights are measured as they enter the window so
 * variable-height messages retain their natural layout without a dependency.
 */
export function VirtualizedTurnList<T>({
	estimateSize,
	getItemKey,
	itemGap = 0,
	items,
	overscan = 1.5,
	renderItem,
	viewportRef,
}: VirtualizedTurnListProps<T>) {
	const itemKeys = useMemo(() => items.map((item, index) => getItemKey(item, index)), [getItemKey, items]);
	const shouldVirtualize = items.length >= TRANSCRIPT_VIRTUALIZATION_THRESHOLD;
	const [measuredHeights, setMeasuredHeights] = useState(() => new Map<string, number>());
	const [viewport, setViewport] = useState<ViewportState>({ height: 0, scrollTop: 0 });
	const itemKeysRef = useRef(itemKeys);
	const measuredHeightsRef = useRef(measuredHeights);
	const estimateSizeRef = useRef(estimateSize);
	const itemGapRef = useRef(itemGap);
	const offsetsRef = useRef([0]);
	const pendingScrollAdjustmentRef = useRef(0);
	const rowNodesRef = useRef(new Map<string, HTMLDivElement>());
	const rowKeysRef = useRef(new WeakMap<Element, string>());
	const rowObserverRef = useRef<ResizeObserver | null>(null);

	const updateViewport = useCallback(() => {
		const element = viewportRef.current;
		if (!element) return;
		const next = { height: element.clientHeight, scrollTop: element.scrollTop };
		setViewport((current) =>
			current.height === next.height && current.scrollTop === next.scrollTop ? current : next,
		);
	}, [viewportRef]);

	const setRowRef = useCallback((key: string, node: HTMLDivElement | null) => {
		const previous = rowNodesRef.current.get(key);
		if (previous && previous !== node) {
			rowObserverRef.current?.unobserve(previous);
			rowNodesRef.current.delete(key);
		}
		if (!node) return;

		rowNodesRef.current.set(key, node);
		rowKeysRef.current.set(node, key);
		rowObserverRef.current?.observe(node);
	}, []);

	const offsets = useMemo(() => {
		return buildOffsets(itemKeys, measuredHeights, estimateSize, itemGap);
	}, [estimateSize, itemGap, itemKeys, measuredHeights]);

	useLayoutEffect(() => {
		updateViewport();
	}, [items.length, updateViewport]);

	useLayoutEffect(() => {
		itemKeysRef.current = itemKeys;
		measuredHeightsRef.current = measuredHeights;
		estimateSizeRef.current = estimateSize;
		itemGapRef.current = itemGap;
		offsetsRef.current = offsets;
	}, [estimateSize, itemGap, itemKeys, measuredHeights, offsets]);

	useEffect(() => {
		const element = viewportRef.current;
		if (!element) return;

		element.addEventListener("scroll", updateViewport, { passive: true });
		window.addEventListener("resize", updateViewport);
		updateViewport();

		let viewportObserver: ResizeObserver | undefined;
		if (typeof ResizeObserver !== "undefined") {
			viewportObserver = new ResizeObserver(updateViewport);
			viewportObserver.observe(element);
		}

		return () => {
			element.removeEventListener("scroll", updateViewport);
			window.removeEventListener("resize", updateViewport);
			viewportObserver?.disconnect();
		};
	}, [updateViewport, viewportRef]);

	const updateMeasuredHeights = useCallback(
		(entries: readonly ResizeObserverEntry[]) => {
			const current = measuredHeightsRef.current;
			let next = current;
			for (const entry of entries) {
				const key = rowKeysRef.current.get(entry.target);
				const height = entry.contentRect.height;
				if (!key || height <= 0 || current.get(key) === height) continue;
				if (next === current) next = new Map(current);
				next.set(key, height);
			}
			if (next === current) return;

			const element = viewportRef.current;
			const itemKeys = itemKeysRef.current;
			const nextOffsets = buildOffsets(itemKeys, next, estimateSizeRef.current, itemGapRef.current);
			if (element && itemKeys.length > 0) {
				const beforeOffsets = offsetsRef.current;
				const anchorIndex = findItemAtOffset(beforeOffsets, Math.max(0, element.scrollTop), itemKeys.length);
				const anchorKey = itemKeys[anchorIndex];
				if (anchorKey && anchorIndex > 0) {
					const nextAnchorIndex = itemKeys.indexOf(anchorKey);
					const offsetDelta = (nextOffsets[nextAnchorIndex] ?? 0) - (beforeOffsets[anchorIndex] ?? 0);
					if (offsetDelta !== 0) pendingScrollAdjustmentRef.current += offsetDelta;
				}
			}

			measuredHeightsRef.current = next;
			offsetsRef.current = nextOffsets;
			setMeasuredHeights(next);
		},
		[viewportRef],
	);

	useLayoutEffect(() => {
		if (!shouldVirtualize || typeof ResizeObserver === "undefined") return;

		const observer = new ResizeObserver((entries) => updateMeasuredHeights(entries));
		rowObserverRef.current = observer;
		for (const node of rowNodesRef.current.values()) observer.observe(node);

		return () => {
			observer.disconnect();
			if (rowObserverRef.current === observer) rowObserverRef.current = null;
		};
	}, [shouldVirtualize, updateMeasuredHeights]);

	useEffect(() => {
		const current = measuredHeightsRef.current;
		if (current.size === 0) return;
		const validKeys = new Set(itemKeys);
		const next = new Map([...current].filter(([key]) => validKeys.has(key)));
		if (next.size === current.size) return;
		measuredHeightsRef.current = next;
		setMeasuredHeights(next);
	}, [itemKeys]);

	useLayoutEffect(() => {
		const adjustment = pendingScrollAdjustmentRef.current;
		const element = viewportRef.current;
		if (!element || adjustment === 0) return;

		element.scrollTop += adjustment;
		pendingScrollAdjustmentRef.current = 0;
		updateViewport();
	}, [measuredHeights, updateViewport, viewportRef]);

	if (!shouldVirtualize) {
		return (
			<>
				{items.map((item, index) => (
					<Fragment key={itemKeys[index]}>{renderItem(item, index)}</Fragment>
				))}
			</>
		);
	}

	const totalHeight = offsets[offsets.length - 1] ?? 0;
	const overscanDistance = Math.max(estimateSize, viewport.height * overscan);
	const firstVisible = findItemAtOffset(offsets, Math.max(0, viewport.scrollTop - overscanDistance), items.length);
	const lastVisible = Math.min(
		items.length - 1,
		findItemAtOffset(offsets, viewport.scrollTop + viewport.height + overscanDistance, items.length) + 1,
	);

	return (
		<div
			data-rendered-turn-count={lastVisible - firstVisible + 1}
			data-total-turn-count={items.length}
			data-virtualized-transcript="true"
			style={{ height: totalHeight, position: "relative", width: "100%" }}
		>
			{items.slice(firstVisible, lastVisible + 1).map((item, index) => {
				const itemIndex = firstVisible + index;
				const key = itemKeys[itemIndex];
				return (
					<div
						key={key}
						ref={(node) => setRowRef(key, node)}
						data-virtualized-turn-index={itemIndex}
						style={{ left: 0, position: "absolute", right: 0, top: offsets[itemIndex] }}
					>
						{renderItem(item, itemIndex)}
					</div>
				);
			})}
		</div>
	);
}
