import * as Observability from "@openuidev/observability-cloud";

/**
 * Start OpenUI Reliability Monitoring before any response renders.
 *
 * The client key is publishable. `THESYS_API_KEY` is the server key and must
 * not be passed here. `init` is a no-op without `window`, and a second call
 * with the same options does nothing.
 */
export function initOpenUIObservability(): void {
	const apiKey = import.meta.env.VITE_OPENUI_CLIENT_KEY;
	if (typeof apiKey !== "string" || !apiKey.startsWith("pk-th-")) return;
	Observability.init({ apiKey, capture: "minimal" });
}
