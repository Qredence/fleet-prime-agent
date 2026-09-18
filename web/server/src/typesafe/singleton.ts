/**
 * TypeSafe service singleton.
 *
 * Pinned on `globalThis` so Vite's SSR full-module restarts (HMR of any route
 * file) don't drop the draft cache between requests. In prod the module never
 * reloads, so this is a no-op. Mirrors `getBridge()` in `../singleton.ts`.
 */
import { readTypeSafeConfig } from "./config";
import { readStoredTypeSafeKey } from "./credentials";
import { createTypeSafeService, type TypeSafeService } from "./service";

type TypeSafeGlobal = { __fleetTypeSafe?: TypeSafeService };
const globalStore = globalThis as unknown as TypeSafeGlobal;

export function getTypeSafeService(): TypeSafeService {
	if (!globalStore.__fleetTypeSafe) {
		globalStore.__fleetTypeSafe = createTypeSafeService({
			config: readTypeSafeConfig(process.env, readStoredTypeSafeKey()),
		});
	}
	return globalStore.__fleetTypeSafe;
}

/**
 * Drops the memoised service so the next request re-reads the key.
 *
 * Required after the credential changes: the service captures `configured` and
 * `apiKey` once at construction, so without this a newly saved key would do
 * nothing until the process restarted.
 */
export function resetTypeSafeService(): void {
	globalStore.__fleetTypeSafe = undefined;
}

export function setTypeSafeServiceForTests(next: TypeSafeService | undefined): void {
	globalStore.__fleetTypeSafe = next;
}
