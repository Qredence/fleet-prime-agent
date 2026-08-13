import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface ItemRect {
	top: number;
	height: number;
	left: number;
	width: number;
}

interface UseProximityHoverOptions {
	axis?: "x" | "y";
}

interface UseProximityHoverReturn {
	activeIndex: number | null;
	setActiveIndex: Dispatch<SetStateAction<number | null>>;
	itemRects: Array<ItemRect | undefined>;
	onMouseMove: (e: React.MouseEvent) => void;
	onMouseLeave: () => void;
	registerItem: (index: number, element: HTMLElement | null) => void;
	measureItems: () => void;
}

export function useProximityHover<T extends HTMLElement>(
	containerRef: RefObject<T | null>,
	options: UseProximityHoverOptions = {},
): UseProximityHoverReturn {
	const { axis = "y" } = options;
	const itemsRef = useRef(new Map<number, HTMLElement>());
	const itemObserversRef = useRef(new Map<number, ResizeObserver>());
	const [activeIndex, setActiveIndex] = useState<number | null>(null);
	const [itemRects, setItemRects] = useState<Array<ItemRect | undefined>>([]);
	const itemRectsRef = useRef<Array<ItemRect | undefined>>([]);
	const rafIdRef = useRef<number | null>(null);
	const remeasureRafIdRef = useRef<number | null>(null);

	const measureItems = useCallback(() => {
		const container = containerRef.current;
		if (!container) return;
		const rects: Array<ItemRect | undefined> = [];
		itemsRef.current.forEach((element, index) => {
			// Use offset* instead of getBoundingClientRect so measurements are
			// unaffected by CSS transforms. offsetTop/offsetLeft are layout values
			// relative to the offsetParent, matching `position: absolute` children.
			rects[index] = {
				top: element.offsetTop,
				height: element.offsetHeight,
				left: element.offsetLeft,
				width: element.offsetWidth,
			};
		});
		const prev = itemRectsRef.current;
		let changed = prev.length !== rects.length;
		for (let i = 0; !changed && i < rects.length; i++) {
			const p = prev[i];
			const r = rects[i];
			if (p === r) continue;
			changed = !p || !r || p.top !== r.top || p.left !== r.left || p.width !== r.width || p.height !== r.height;
		}
		if (!changed) return;
		itemRectsRef.current = rects;
		setItemRects(rects);
	}, [containerRef]);

	const scheduleRemeasure = useCallback(() => {
		if (remeasureRafIdRef.current !== null) {
			cancelAnimationFrame(remeasureRafIdRef.current);
		}
		remeasureRafIdRef.current = requestAnimationFrame(() => {
			remeasureRafIdRef.current = null;
			measureItems();
		});
	}, [measureItems]);

	const registerItem = useCallback(
		(index: number, element: HTMLElement | null) => {
			const existingObserver = itemObserversRef.current.get(index);
			if (existingObserver) {
				existingObserver.disconnect();
				itemObserversRef.current.delete(index);
			}

			if (element) {
				itemsRef.current.set(index, element);
				if (typeof ResizeObserver !== "undefined") {
					const observer = new ResizeObserver(() => scheduleRemeasure());
					observer.observe(element);
					itemObserversRef.current.set(index, observer);
				}
			} else {
				itemsRef.current.delete(index);
			}

			scheduleRemeasure();
		},
		[scheduleRemeasure],
	);

	const onMouseMove = useCallback(
		(e: React.MouseEvent) => {
			const mouseX = e.clientX;
			const mouseY = e.clientY;

			if (rafIdRef.current !== null) {
				cancelAnimationFrame(rafIdRef.current);
			}

			rafIdRef.current = requestAnimationFrame(() => {
				rafIdRef.current = null;
				const container = containerRef.current;
				if (!container) return;

				const containerRect = container.getBoundingClientRect();
				const mousePos = axis === "x" ? mouseX : mouseY;

				let closestIndex: number | null = null;
				let closestDistance = Infinity;
				let containingIndex: number | null = null;

				const rects = itemRectsRef.current;
				const scrollOffset = axis === "x" ? container.scrollLeft : container.scrollTop;
				const borderOffset = axis === "x" ? container.clientLeft : container.clientTop;
				const containerEdge = axis === "x" ? containerRect.left : containerRect.top;
				const layoutSize = axis === "x" ? container.offsetWidth : container.offsetHeight;
				const visualSize = axis === "x" ? containerRect.width : containerRect.height;
				const scale = layoutSize > 0 ? visualSize / layoutSize : 1;

				for (let index = 0; index < rects.length; index++) {
					const r = rects[index];
					if (!r) continue;

					const contentPos = axis === "x" ? r.left : r.top;
					const itemStart = containerEdge + (borderOffset + contentPos - scrollOffset) * scale;
					const itemSize = (axis === "x" ? r.width : r.height) * scale;
					const itemEnd = itemStart + itemSize;

					if (mousePos >= itemStart && mousePos <= itemEnd) {
						containingIndex = index;
					}

					const itemCenter = itemStart + itemSize / 2;
					const distance = Math.abs(mousePos - itemCenter);

					if (distance < closestDistance) {
						closestDistance = distance;
						closestIndex = index;
					}
				}

				setActiveIndex(containingIndex ?? closestIndex);
			});
		},
		[axis, containerRef],
	);

	const onMouseLeave = useCallback(() => {
		if (rafIdRef.current !== null) {
			cancelAnimationFrame(rafIdRef.current);
			rafIdRef.current = null;
		}
		setActiveIndex(null);
	}, []);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => scheduleRemeasure());
		ro.observe(container);
		return () => ro.disconnect();
	}, [containerRef, scheduleRemeasure]);

	useEffect(() => {
		return () => {
			if (rafIdRef.current !== null) {
				cancelAnimationFrame(rafIdRef.current);
			}
			if (remeasureRafIdRef.current !== null) {
				cancelAnimationFrame(remeasureRafIdRef.current);
			}
			itemObserversRef.current.forEach((observer) => {
				observer.disconnect();
			});
			itemObserversRef.current.clear();
		};
	}, []);

	return {
		activeIndex,
		setActiveIndex,
		itemRects,
		onMouseMove,
		onMouseLeave,
		registerItem,
		measureItems,
	};
}
