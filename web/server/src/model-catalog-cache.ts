/**
 * Process-local cache of the daemon's model catalog.
 *
 * `get_model_catalog` needs an `activeSessionId`, and a throwaway session per
 * request measures ~280 ms p50 plus worker/log churn in the user's agent dir,
 * against ~20 ms for a read on a session that already exists. The chat page
 * loads this route on every visit, so the catalog is cached here and refreshed
 * only on a miss, an expiry, or an invalidation.
 *
 * Correctness does not depend on the cache being fresh. The daemon re-parses
 * `models.json` and `auth.json` on every read with no TTL, so a read made after
 * a write always sees that write. What the cache can hide is a write Fleet did
 * not make: hence the short max age on top of the explicit invalidations.
 *
 * Pinned on `globalThis` for the same reason as `prime-config.ts` and the
 * bridge singleton: Vite's SSR full-module restarts must not drop the snapshot
 * and force a refresh storm mid-request.
 */
import type { DaemonModelCatalog } from "./daemon-protocol";

/** How long a snapshot may be served without asking the daemon again. */
export const MODEL_CATALOG_MAX_AGE_MS = 5_000;

type CatalogSnapshot = { catalog: DaemonModelCatalog; fetchedAt: number };

type CatalogCacheState = {
	snapshot?: CatalogSnapshot;
	/** Single-flight: concurrent callers share one refresh. */
	inFlight?: Promise<CatalogSnapshot | undefined>;
	/** Bumped by every invalidation so a pre-invalidation refresh cannot land. */
	generation: number;
};

type CatalogCacheGlobal = { __fleetModelCatalogCache?: CatalogCacheState };

function cacheState(): CatalogCacheState {
	const globalStore = globalThis as unknown as CatalogCacheGlobal;
	globalStore.__fleetModelCatalogCache ??= { generation: 0 };
	return globalStore.__fleetModelCatalogCache;
}

/** The cached snapshot when it is still within its max age, else `undefined`. */
export function readModelCatalogSnapshot(maxAgeMs = MODEL_CATALOG_MAX_AGE_MS): DaemonModelCatalog | undefined {
	const { snapshot } = cacheState();
	if (!snapshot) return undefined;
	return Date.now() - snapshot.fetchedAt <= maxAgeMs ? snapshot.catalog : undefined;
}

/**
 * Read the catalog through the cache, refreshing it on a miss or expiry.
 *
 * A failed refresh leaves the cache as it was and rejects with the caller's
 * error; it never fabricates an empty catalog, because an empty list would read
 * to the user as "you have no models" instead of "the runtime could not be
 * reached".
 */
export async function loadModelCatalog(
	refresh: () => Promise<DaemonModelCatalog>,
	maxAgeMs = MODEL_CATALOG_MAX_AGE_MS,
): Promise<DaemonModelCatalog> {
	const cached = readModelCatalogSnapshot(maxAgeMs);
	if (cached) return cached;

	const state = cacheState();
	if (!state.inFlight) {
		const startedAt = state.generation;
		state.inFlight = (async () => {
			try {
				const catalog = await refresh();
				const next: CatalogSnapshot = { catalog, fetchedAt: Date.now() };
				const current = cacheState();
				// An invalidation during the refresh means this read predates the
				// change it was meant to reflect, so it is not cached and its
				// callers retry instead of serving it.
				if (current.generation !== startedAt) return undefined;
				current.snapshot = next;
				return next;
			} finally {
				cacheState().inFlight = undefined;
			}
		})();
	}
	const settled = await state.inFlight;
	if (settled) return settled.catalog;
	return loadModelCatalog(refresh, maxAgeMs);
}

/** Drop the cached snapshot so the next read refreshes. */
export function invalidateModelCatalog(): void {
	const state = cacheState();
	state.snapshot = undefined;
	state.generation += 1;
}

/** Clear all cache state (tests). */
export function resetModelCatalogCacheForTests(): void {
	const globalStore = globalThis as unknown as CatalogCacheGlobal;
	globalStore.__fleetModelCatalogCache = undefined;
}
