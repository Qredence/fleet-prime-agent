import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initAnalytics } from "./analytics-stub";

type FakePerformanceObserverList = {
	getEntries: () => PerformanceEntryList;
};

class FakePerformanceObserver {
	static instances: FakePerformanceObserver[] = [];

	private pendingEntries: PerformanceEntryList = [];

	constructor(private readonly callback: (list: FakePerformanceObserverList) => void) {
		FakePerformanceObserver.instances.push(this);
	}

	observe(_options: PerformanceObserverInit): void {}

	disconnect(): void {}

	takeRecords(): PerformanceEntryList {
		const entries = this.pendingEntries;
		this.pendingEntries = [];
		return entries;
	}

	emit(entries: PerformanceEntryList): void {
		this.callback({ getEntries: () => entries });
	}
}

function entry(values: Partial<PerformanceEntry> & Record<string, unknown>): PerformanceEntry {
	return values as PerformanceEntry;
}

describe("initAnalytics web vitals", () => {
	let debug: ReturnType<typeof vi.spyOn>;
	let addEventListener: ReturnType<typeof vi.spyOn>;
	let interactionCountDescriptor: PropertyDescriptor | undefined;

	beforeEach(() => {
		FakePerformanceObserver.instances = [];
		vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
		debug = vi.spyOn(console, "debug").mockImplementation(() => {});
		addEventListener = vi.spyOn(window, "addEventListener");
		interactionCountDescriptor = Object.getOwnPropertyDescriptor(performance, "interactionCount");
		delete (window as unknown as { __fleetVitalsInit?: boolean }).__fleetVitalsInit;
	});

	afterEach(() => {
		for (const [type, listener, options] of addEventListener.mock.calls) {
			if (type === "pageshow") {
				window.removeEventListener(type, listener as EventListener, options);
			}
		}
		if (interactionCountDescriptor) {
			Object.defineProperty(performance, "interactionCount", interactionCountDescriptor);
		} else {
			Reflect.deleteProperty(performance, "interactionCount");
		}
		delete (window as unknown as { __fleetVitalsInit?: boolean }).__fleetVitalsInit;
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("reports finalized LCP, CLS, and INP values at the page boundary", () => {
		initAnalytics();
		expect(FakePerformanceObserver.instances).toHaveLength(3);

		const [lcp, cls, inp] = FakePerformanceObserver.instances;
		lcp.emit([entry({ startTime: 100 }), entry({ startTime: 300 })]);
		cls.emit([
			entry({ startTime: 100, value: 0.1, hadRecentInput: false }),
			entry({ startTime: 500, value: 0.2, hadRecentInput: false }),
			entry({ startTime: 2_000, value: 0.8, hadRecentInput: false }),
			entry({ startTime: 2_100, value: 99, hadRecentInput: true }),
			entry({ startTime: 2_500, value: 0.9, hadRecentInput: false }),
		]);
		inp.emit([
			entry({ interactionId: 7, duration: 60 }),
			entry({ interactionId: 7, duration: 120 }),
			entry({ interactionId: 8, duration: 80 }),
		]);

		expect(debug).not.toHaveBeenCalled();

		window.dispatchEvent(new Event("pagehide"));

		expect(debug.mock.calls).toEqual([["[vitals] LCP: 300"], ["[vitals] CLS: 2"], ["[vitals] INP: 120"]]);
	});

	it("uses the INP p98 estimate for interaction-heavy pages", () => {
		Object.defineProperty(performance, "interactionCount", { configurable: true, value: 100 });
		initAnalytics();

		const inp = FakePerformanceObserver.instances[2];
		inp.emit(Array.from({ length: 100 }, (_, index) => entry({ interactionId: index + 1, duration: index + 1 })));
		window.dispatchEvent(new Event("pagehide"));

		expect(debug).toHaveBeenCalledWith("[vitals] INP: 98");
	});

	it("recreates measurement state after a bfcache restore", () => {
		initAnalytics();
		const [lcp] = FakePerformanceObserver.instances;
		lcp.emit([entry({ startTime: 100 })]);
		window.dispatchEvent(new Event("pagehide"));

		const pageshow = new Event("pageshow");
		Object.defineProperty(pageshow, "persisted", { value: true });
		window.dispatchEvent(pageshow);

		expect(FakePerformanceObserver.instances).toHaveLength(6);
		const [restoredLcp, restoredCls, restoredInp] = FakePerformanceObserver.instances.slice(3);
		restoredLcp.emit([entry({ startTime: 500 })]);
		restoredCls.emit([entry({ startTime: 500, value: 0.25, hadRecentInput: false })]);
		restoredInp.emit([entry({ interactionId: 9, duration: 90 })]);
		window.dispatchEvent(new Event("pagehide"));

		expect(debug.mock.calls).toEqual([
			["[vitals] LCP: 100"],
			["[vitals] LCP: 500"],
			["[vitals] CLS: 0"],
			["[vitals] INP: 90"],
		]);
	});
});
