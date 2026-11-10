/**
 * Stable OpenUI Cloud user id for this Fleet install.
 *
 * Dashboards belong to this id. It is created once, stored on `thesys.json`
 * under the same lock as the key, and is never taken from the request body.
 * A legacy `dashboard-user-id` file is copied once and then left in place.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RUNTIME_FILE_MODE, updateJsonObjectFile } from "../agent-file-writer";
import { getPrimeConfig } from "../prime-config";

const THESYS_FILE = "thesys.json";
const LEGACY_FILE = "dashboard-user-id";

function stringFrom(record: Record<string, unknown>, field: string): string | undefined {
	const value = record[field];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readLegacyUserId(agentDir: string): Promise<string | undefined> {
	try {
		const existing = (await readFile(join(agentDir, LEGACY_FILE), "utf8")).trim();
		return existing || undefined;
	} catch {
		return undefined;
	}
}

export async function dashboardUserId(agentDir = getPrimeConfig().agentDir): Promise<string> {
	const legacy = await readLegacyUserId(agentDir);
	const outcome = await updateJsonObjectFile<string>(
		join(agentDir, THESYS_FILE),
		(current) => {
			const existing = stringFrom(current, "userId");
			if (existing) return { unchanged: existing };
			const id = legacy ?? `fleet-${randomUUID()}`;
			return { next: { ...current, userId: id }, result: id };
		},
		{ mode: RUNTIME_FILE_MODE },
	);
	if (outcome.status === "refused") throw new Error(outcome.reason);
	return outcome.value;
}
