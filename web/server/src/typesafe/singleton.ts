/**
 * TypeSafe service singleton.
 *
 * Pinned on `globalThis` so Vite's SSR full-module restarts (HMR of any route
 * file) don't drop the draft cache between requests. In prod the module never
 * reloads, so this is a no-op. Mirrors `getBridge()` in `../singleton.ts`.
 */
import { createTypeSafeService, type TypeSafeService } from "./service";

type TypeSafeGlobal = { __fleetTypeSafe?: TypeSafeService };
const globalStore = globalThis as unknown as TypeSafeGlobal;

export function getTypeSafeService(): TypeSafeService {
	if (!globalStore.__fleetTypeSafe) {
		globalStore.__fleetTypeSafe = createTypeSafeService();
	}
	return globalStore.__fleetTypeSafe;
}

export function setTypeSafeServiceForTests(next: TypeSafeService | undefined): void {
	globalStore.__fleetTypeSafe = next;
}
