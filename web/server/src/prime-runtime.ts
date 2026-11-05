import manifest from "../../../PRIME_AGENT_RUNTIME.json";
import { ensurePrimeRuntime } from "../../../packages/fleet-web/bin/prime-runtime.mjs";

/**
 * Install (or reuse) the pinned Prime Agent runtime: the `prime-agent` binary
 * and the `prime-agent-runtime/` kernel bundle beside it.
 *
 * The npm launcher and the server share one installer so a `fleet-prime`
 * install and a server-side install cannot drift apart again.
 */
export function ensurePrimeAgentRuntime(
	options: { target?: string; installRoot?: string; home?: string; fetch?: typeof fetch } = {},
): Promise<string> {
	return ensurePrimeRuntime({ manifest, ...options });
}
