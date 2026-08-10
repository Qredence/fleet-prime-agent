/**
 * Bridge singleton — shared across all route handlers in this process.
 *
 * Instantiating one bridge per Node process lets `POST /api/chat/binary op` and
 * `GET /api/chat/events` share the same live session map and ring buffer.
 * Routes import this via `@/server/singleton`.
 *
 * Pinned on `globalThis` so Vite's SSR full-module restarts (HMR of any
 * route file) don't wipe active `AgentSession`s, open dialog promises, or
 * NDJSON subscriptions. In prod the module never reloads, so this is a no-op.
 */
import { PrimeBridge } from "./prime-bridge"

type BridgeGlobal = { __primeBridge?: PrimeBridge }
const globalStore = globalThis as unknown as BridgeGlobal

export function getBridge(): PrimeBridge {
	if (!globalStore.__primeBridge) {
		globalStore.__primeBridge = new PrimeBridge({
			kernelTimeoutMs: 30_000,
			ringBufferCapacity: 500,
			dialogTimeoutMs: 60_000,
		})
	}
	return globalStore.__primeBridge
}

export function resetBridgeForTests(): PrimeBridge {
	globalStore.__primeBridge?.resetForTests()
	globalStore.__primeBridge = undefined
	return getBridge()
}

export function setBridgeForTests(next: PrimeBridge): void {
	globalStore.__primeBridge = next
}
