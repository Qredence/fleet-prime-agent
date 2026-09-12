import { VirtualizedTurnList } from "@prime-agent/web-design/components/product/fleet-pi/chat/virtualized-turn-list";
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

function Harness({ count }: { count: number }) {
	const viewportRef = useRef<HTMLElement | null>(null);
	const items = Array.from({ length: count }, (_, index) => index);

	return (
		<VirtualizedTurnList
			estimateSize={100}
			getItemKey={(item) => `turn-${item}`}
			items={items}
			renderItem={(item) => <div data-testid={`turn-${item}`}>Turn {item}</div>}
			viewportRef={viewportRef}
		/>
	);
}

function ScrollableHarness({ count }: { count: number }) {
	const viewportRef = useRef<HTMLElement | null>(null);
	const items = Array.from({ length: count }, (_, index) => index);

	return (
		<div
			data-testid="viewport"
			ref={(node) => {
				viewportRef.current = node;
			}}
		>
			<VirtualizedTurnList
				estimateSize={100}
				getItemKey={(item) => `turn-${item}`}
				items={items}
				renderItem={(item) => <div data-testid={`turn-${item}`}>Turn {item}</div>}
				viewportRef={viewportRef}
			/>
		</div>
	);
}

class TestResizeObserver {
	static instances: TestResizeObserver[] = [];
	readonly targets = new Set<Element>();
	readonly callback: ResizeObserverCallback;

	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
		TestResizeObserver.instances.push(this);
	}

	observe(target: Element) {
		this.targets.add(target);
	}

	unobserve(target: Element) {
		this.targets.delete(target);
	}

	disconnect() {
		this.targets.clear();
	}

	emit(target: Element, height: number) {
		this.callback(
			[
				{
					target,
					contentRect: { height } as DOMRectReadOnly,
				} as ResizeObserverEntry,
			],
			this as unknown as ResizeObserver,
		);
	}
}

describe("VirtualizedTurnList", () => {
	afterEach(() => {
		TestResizeObserver.instances = [];
		vi.unstubAllGlobals();
	});

	it("keeps short transcripts fully rendered", () => {
		render(<Harness count={2} />);

		expect(document.querySelector("[data-virtualized-transcript]")).toBeNull();
		expect(screen.getByTestId("turn-0")).toBeTruthy();
		expect(screen.getByTestId("turn-1")).toBeTruthy();
	});

	it("windows long transcripts instead of mounting every turn", () => {
		render(<Harness count={50} />);

		const list = document.querySelector<HTMLElement>("[data-virtualized-transcript]");
		expect(list).not.toBeNull();
		expect(list?.dataset.totalTurnCount).toBe("50");
		expect(Number(list?.dataset.renderedTurnCount)).toBeLessThan(50);
		expect(document.querySelectorAll("[data-virtualized-turn-index]").length).toBeLessThan(50);
	});

	it("preserves the reader anchor when a preceding turn is measured", async () => {
		vi.stubGlobal("ResizeObserver", TestResizeObserver);
		render(<ScrollableHarness count={50} />);

		const viewport = screen.getByTestId("viewport");
		let scrollTop = 0;
		Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 200 });
		Object.defineProperty(viewport, "scrollTop", {
			configurable: true,
			get: () => scrollTop,
			set: (value: number) => {
				scrollTop = value;
			},
		});

		await act(async () => {
			scrollTop = 1_000;
			viewport.dispatchEvent(new Event("scroll"));
			await Promise.resolve();
		});

		const anchor = document.querySelector<HTMLElement>('[data-virtualized-turn-index="10"]');
		const precedingRow = document.querySelector<HTMLElement>('[data-virtualized-turn-index="7"]');
		const rowObserver = TestResizeObserver.instances.find((observer) => observer.targets.has(precedingRow!));

		expect(anchor?.style.top).toBe("1000px");
		expect(rowObserver).toBeDefined();

		await act(async () => {
			rowObserver?.emit(precedingRow!, 180);
			await Promise.resolve();
		});

		expect(viewport.scrollTop).toBe(1_080);
		expect(anchor?.style.top).toBe("1080px");
	});
});
