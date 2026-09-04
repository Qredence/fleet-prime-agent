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
	try {
		const lcp = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				onVital({ name: "LCP", value: entry.startTime, url });
			}
		});
		lcp.observe({ type: "largest-contentful-paint", buffered: true });
		observers.push(lcp);

		let clsValue = 0;
		const cls = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				const layoutEntry = entry as PerformanceEntry & {
					hadRecentInput?: boolean;
					value?: number;
				};
				if (!layoutEntry.hadRecentInput) {
					clsValue += layoutEntry.value ?? 0;
					onVital({ name: "CLS", value: clsValue, url });
				}
			}
		});
		cls.observe({ type: "layout-shift", buffered: true });
		observers.push(cls);

		const inp = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				const eventEntry = entry as PerformanceEntry & {
					interactionId?: number;
					duration?: number;
				};
				if (eventEntry.interactionId) {
					onVital({ name: "INP", value: eventEntry.duration ?? 0, url });
				}
			}
		});
		inp.observe({ type: "event", buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
		observers.push(inp);
	} catch {
		// PerformanceObserver types vary by browser; vitals are best-effort.
	}
	return () => {
		for (const observer of observers) observer.disconnect();
	};
}

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
