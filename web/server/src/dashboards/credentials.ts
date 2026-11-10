/**
 * The stored Thesys API key.
 *
 * It lives in `thesys.json` beside the agent directory, not in `auth.json`.
 * Auth entries are listed as model providers, and this key is not one.
 * The file is owner-only. The browser never receives the value.
 *
 * A key saved here wins over the environment. OpenUI's documented name is
 * `THESYS_API_KEY`. The environment is the fallback, which is where a local
 * `web/app/.env` is loaded.
 */
import { join } from "node:path";
import {
	type DashboardKeySource,
	type DashboardMode,
	DEFAULT_DASHBOARD_MODEL,
} from "@prime-agent/web-protocol/dashboards";
import { RUNTIME_FILE_MODE, readJsonObjectFile, updateJsonObjectFile } from "../agent-file-writer";
import { getPrimeConfig } from "../prime-config";

const THESYS_FILE = "thesys.json";

/** Server-only override, so a deployment can pin its BYOK provider's model. */
const DASHBOARD_MODEL_ENV = "FLEET_DASHBOARD_MODEL";

function thesysFile(agentDir: string): string {
	return join(agentDir, THESYS_FILE);
}

function stringFrom(record: Record<string, unknown>, field: string): string | undefined {
	const value = record[field];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readStoredThesys(agentDir: string): Promise<Record<string, unknown> | undefined> {
	const current = await readJsonObjectFile(thesysFile(agentDir));
	return current.kind === "ok" ? current.value : undefined;
}

async function readStoredThesysKey(agentDir = getPrimeConfig().agentDir): Promise<string | undefined> {
	const stored = await readStoredThesys(agentDir);
	return stored ? stringFrom(stored, "key") : undefined;
}

export async function writeStoredThesysKey(key: string, agentDir = getPrimeConfig().agentDir): Promise<void> {
	const trimmed = key.trim();
	if (!trimmed) throw new Error("A Thesys API key cannot be empty");
	const outcome = await updateJsonObjectFile(
		thesysFile(agentDir),
		(current) => ({ next: { ...current, key: trimmed }, result: true }),
		{ mode: RUNTIME_FILE_MODE },
	);
	if (outcome.status === "refused") throw new Error(outcome.reason);
}

export async function clearStoredThesysKey(agentDir = getPrimeConfig().agentDir): Promise<void> {
	const outcome = await updateJsonObjectFile(
		thesysFile(agentDir),
		(current) => {
			const { key: _key, ...rest } = current;
			return { next: rest, result: true };
		},
		{ mode: RUNTIME_FILE_MODE },
	);
	if (outcome.status === "refused") throw new Error(outcome.reason);
}

/** The stored dashboard model, if an operator set one here. */
async function readStoredDashboardModel(agentDir = getPrimeConfig().agentDir): Promise<string | undefined> {
	const stored = await readStoredThesys(agentDir);
	return stored ? stringFrom(stored, "model") : undefined;
}

export async function writeStoredDashboardModel(model: string, agentDir = getPrimeConfig().agentDir): Promise<void> {
	const trimmed = model.trim();
	if (!trimmed) throw new Error("A dashboard model cannot be empty");
	const outcome = await updateJsonObjectFile(
		thesysFile(agentDir),
		(current) => ({ next: { ...current, model: trimmed }, result: true }),
		{ mode: RUNTIME_FILE_MODE },
	);
	if (outcome.status === "refused") throw new Error(outcome.reason);
}

export async function clearStoredDashboardModel(agentDir = getPrimeConfig().agentDir): Promise<void> {
	const outcome = await updateJsonObjectFile(
		thesysFile(agentDir),
		(current) => {
			const { model: _model, ...rest } = current;
			return { next: rest, result: true };
		},
		{ mode: RUNTIME_FILE_MODE },
	);
	if (outcome.status === "refused") throw new Error(outcome.reason);
}

function environmentThesysKey(env: NodeJS.Dict<string>): string | undefined {
	return env.THESYS_API_KEY?.trim() || undefined;
}

export async function resolveThesysApiKey(
	env: NodeJS.Dict<string> = process.env,
	agentDir = getPrimeConfig().agentDir,
): Promise<string | undefined> {
	const stored = await readStoredThesysKey(agentDir);
	if (stored) return stored;
	return environmentThesysKey(env);
}

/**
 * The model that builds dashboards: a stored setting, then the server
 * environment, then OpenUI's recommended default.
 */
export async function resolveDashboardModel(
	env: NodeJS.Dict<string> = process.env,
	agentDir = getPrimeConfig().agentDir,
): Promise<{ model: string; source: "settings" | "environment" | "default" }> {
	const stored = await readStoredDashboardModel(agentDir);
	if (stored) return { model: stored, source: "settings" };
	const fromEnv = env[DASHBOARD_MODEL_ENV]?.trim();
	if (fromEnv) return { model: fromEnv, source: "environment" };
	return { model: DEFAULT_DASHBOARD_MODEL, source: "default" };
}

export async function thesysKeySource(
	env: NodeJS.Dict<string> = process.env,
	agentDir = getPrimeConfig().agentDir,
): Promise<DashboardKeySource> {
	if (await readStoredThesysKey(agentDir)) return "settings";
	if (environmentThesysKey(env)) return "environment";
	return "none";
}

export async function dashboardMode(
	env: NodeJS.Dict<string> = process.env,
	agentDir = getPrimeConfig().agentDir,
): Promise<DashboardMode> {
	return (await resolveThesysApiKey(env, agentDir)) ? "cloud" : "self-hosted";
}
