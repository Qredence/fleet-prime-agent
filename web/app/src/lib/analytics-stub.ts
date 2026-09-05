// v1: no analytics. All imports of @/lib/analytics/posthog funnel through here.

type WebVital = {
	name: "LCP" | "INP" | "CLS";
	value: number;
	url: string;
};

/**
 * Hand-rolled LCP/INP/CLS observer — zero dependencies by design (do NOT add
 * the `web-vitals` package for this). In DEV it logs to the console; in
 * production it beacons a JSON payload to `/api/analytics/vitals` (fire and
 * forget; the endpoint is optional — failures are silently ignored).
 */
function observeWebVitals(onVital: (vital: WebVital) => void): () => void {
	if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") {
		return () => {};
	}
	const url = window.location.pathname;
	const observers: Array<PerformanceObserver> = [];
	let lcpValue: number | undefined;
	let lcpReported = false;
	let pageMetricsReported = false;
	try {
		const lcp = new PerformanceObserver((list) => {
			if (lcpReported) return;
			const entries = list.getEntries();
			const entry = entries[entries.length - 1];
			if (entry) {
				lcpValue = entry.startTime;
			}
		});
		lcp.observe({ type: "largest-contentful-paint", buffered: true });
		observers.push(lcp);

		let clsValue = 0;
		let clsSessionValue = 0;
		let clsSessionStart = 0;
		let clsSessionEnd = 0;
		let hasClsSession = false;
		const processClsEntries = (entries: PerformanceEntryList) => {
			for (const entry of entries) {
				const layoutEntry = entry as PerformanceEntry & {
					hadRecentInput?: boolean;
					value?: number;
				};
				if (!layoutEntry.hadRecentInput) {
					const entryValue = layoutEntry.value ?? 0;
					if (
						hasClsSession &&
						entry.startTime - clsSessionEnd < 1_000 &&
						entry.startTime - clsSessionStart < 5_000
					) {
						clsSessionValue += entryValue;
					} else {
						clsSessionValue = entryValue;
						clsSessionStart = entry.startTime;
					}
					hasClsSession = true;
					clsSessionEnd = entry.startTime;
					clsValue = Math.max(clsValue, clsSessionValue);
				}
			}
		};
		const cls = new PerformanceObserver((list) => processClsEntries(list.getEntries()));
		cls.observe({ type: "layout-shift", buffered: true });
		observers.push(cls);

		const interactionDurations = new Map<number, number>();
		const processInteractionEntries = (entries: PerformanceEntryList) => {
			for (const entry of entries) {
				const eventEntry = entry as PerformanceEntry & {
					interactionId?: number;
					duration?: number;
				};
				if (eventEntry.interactionId) {
					interactionDurations.set(
						eventEntry.interactionId,
						Math.max(interactionDurations.get(eventEntry.interactionId) ?? 0, eventEntry.duration ?? 0),
					);
				}
			}
		};
		const inp = new PerformanceObserver((list) => processInteractionEntries(list.getEntries()));
		inp.observe({ type: "event", buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
		observers.push(inp);

		const finalizeLcp = () => {
			if (lcpReported) return;
			const pendingEntries = lcp.takeRecords();
			const entry = pendingEntries[pendingEntries.length - 1];
			if (entry) lcpValue = entry.startTime;
			lcpReported = true;
			if (lcpValue !== undefined) onVital({ name: "LCP", value: lcpValue, url });
		};
		const finalizePageMetrics = () => {
			if (pageMetricsReported) return;
			finalizeLcp();
			processClsEntries(cls.takeRecords());
			processInteractionEntries(inp.takeRecords());
			pageMetricsReported = true;
			if (hasClsSession) onVital({ name: "CLS", value: clsValue, url });
			if (interactionDurations.size > 0) {
				onVital({ name: "INP", value: Math.max(...interactionDurations.values()), url });
			}
		};
		const finalizeLcpOnInteraction = () => finalizeLcp();
		const finalizeOnVisibilityChange = () => {
			if (document.visibilityState === "hidden") finalizePageMetrics();
		};
		const interactionEvents = ["pointerdown", "keydown", "touchstart"] as const;
		for (const eventName of interactionEvents) {
			window.addEventListener(eventName, finalizeLcpOnInteraction, { capture: true });
		}
		document.addEventListener("visibilitychange", finalizeOnVisibilityChange);
		window.addEventListener("pagehide", finalizePageMetrics);

		return () => {
			finalizePageMetrics();
			for (const eventName of interactionEvents) {
				window.removeEventListener(eventName, finalizeLcpOnInteraction, { capture: true });
			}
			document.removeEventListener("visibilitychange", finalizeOnVisibilityChange);
			window.removeEventListener("pagehide", finalizePageMetrics);
			for (const observer of observers) observer.disconnect();
		};
	} catch {
		// PerformanceObserver types vary by browser; vitals are best-effort.
	}
	return () => {
		for (const observer of observers) observer.disconnect();
	};
}

/**
 * Initializes web vitals tracking for performance monitoring. Observes LCP,
 * INP, and CLS metrics and reports them to the console in development or
 * beacons them to the analytics endpoint in production.
 */
export function initAnalytics(): void {
	if (typeof window === "undefined") return;
	if ((window as unknown as { __fleetVitalsInit?: boolean }).__fleetVitalsInit) return;
	(window as unknown as { __fleetVitalsInit?: boolean }).__fleetVitalsInit = true;
	const report = (vital: WebVital) => {
		if (import.meta.env.DEV) {
			console.debug(`[vitals] ${vital.name}: ${Math.round(vital.value)}`);
			return;
		}
		try {
			const payload = JSON.stringify(vital);
			if (navigator.sendBeacon) {
				navigator.sendBeacon("/api/analytics/vitals", payload);
			}
		} catch {
			// Telemetry must never break the app.
		}
	};
	observeWebVitals(report);
}

export function identifyAnalyticsUser(_user: unknown): void {}

export function resetAnalytics(): void {}

export function captureChatSessionStarted(_input: {
	promptLength?: number;
	messageLength?: number;
	sessionId?: string;
	mode?: string;
	model?: string;
	hasImage?: boolean;
}): void {}

export function captureConversationSaved(_input: { sessionId?: string; messageCount?: number }): void {}
