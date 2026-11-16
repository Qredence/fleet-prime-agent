import { AsyncLocalStorage } from "node:async_hooks";

type RequestLeases = { active: boolean; releases: Map<string, () => void> };
const requests = new AsyncLocalStorage<RequestLeases>();

/** Hold resolved sessions through HTTP or background sidecar work, not response streaming. */
export function retainSessionInScope(sessionId: string, retain: () => () => void): void {
	const request = requests.getStore();
	if (request?.active && !request.releases.has(sessionId)) request.releases.set(sessionId, retain());
}

export function withSessionLeaseScope<T>(operation: () => Promise<T>): Promise<T> {
	const request: RequestLeases = { active: true, releases: new Map() };
	return requests.run(request, async () => {
		try {
			return await operation();
		} finally {
			request.active = false;
			for (const release of request.releases.values()) release();
			request.releases.clear();
		}
	});
}
