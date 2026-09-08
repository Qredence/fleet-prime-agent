declare const __FLEET_VERSION__: string | undefined;

/**
 * Released `@qredence/fleet` version baked in at build time via the
 * `__FLEET_VERSION__` vite define (read from `packages/fleet-web`).
 * Falls back to `"dev"` wherever the define is absent (unit tests, and any
 * consumer not bundled through the web build).
 */
export function fleetVersion(): string {
	try {
		return typeof __FLEET_VERSION__ === "string" && __FLEET_VERSION__.length > 0 ? __FLEET_VERSION__ : "dev";
	} catch {
		return "dev";
	}
}
