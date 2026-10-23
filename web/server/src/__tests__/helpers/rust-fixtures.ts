import { readFileSync } from "node:fs";
import { join } from "node:path";

export const RUST_V0101_FIXTURE_DIR = join(import.meta.dirname, "..", "fixtures", "daemon-frames", "rust-v0.10.1");

/** Raw daemon→client frames of one rust-v0.10.1 fixture, one per JSONL line. */
export function readRustFixture(name: string): Array<Record<string, unknown> & { type: string }> {
	return readFileSync(join(RUST_V0101_FIXTURE_DIR, name), "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown> & { type: string });
}

export function readRustFixtureLines(name: string): string[] {
	return readFileSync(join(RUST_V0101_FIXTURE_DIR, name), "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0);
}
