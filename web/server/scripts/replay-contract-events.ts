/**
 * Regenerate `<scenario>.events.json` goldens for an existing daemon-frame set
 * by replaying its committed frames through the harness (no daemon needed).
 * Use for sets that are not recorded by record-contract-fixtures.ts, e.g. the
 * live-captured Rust set:
 *
 *   pnpm --filter @prime-agent/web-server replay:contract-events rust-v0.10.1
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	DAEMON_FRAMES_ROOT,
	listDaemonFrameScenarios,
	readDaemonFrameScenario,
	replayDaemonFrameScenario,
} from "../src/__tests__/daemon-frame-replay";

const [set, ...only] = process.argv.slice(2);
if (!set) throw new Error("usage: replay-contract-events <set> [scenario...]");
const names = only.length > 0 ? only : listDaemonFrameScenarios(set);
for (const name of names) {
	const { events } = await replayDaemonFrameScenario(readDaemonFrameScenario(set, name));
	writeFileSync(join(DAEMON_FRAMES_ROOT, set, `${name}.events.json`), `${JSON.stringify(events, null, "\t")}\n`);
	process.stdout.write(`${set}/${name}: ${events.length} events\n`);
}
