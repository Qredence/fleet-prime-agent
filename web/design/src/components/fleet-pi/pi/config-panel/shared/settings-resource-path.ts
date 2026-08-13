import type { ChatResourceInfo } from "@prime-agent/web-protocol/chat-protocol";

/** Discovery provenance — never a `.pi/settings.json` resource path. */
const PROVENANCE_SOURCES = new Set(["auto", "global", "local", "project", "workspace"]);

/**
 * Value written to Pi settings when picking a catalog entry.
 * Prefer package/path sources (`npm:…`, relative paths). Ignore provenance
 * labels like `auto`/`local` so options stay unique and match settings paths.
 */
export function resourceOptionValue(item: ChatResourceInfo) {
	const source = item.source?.trim();
	if (source && !PROVENANCE_SOURCES.has(source)) {
		return source;
	}

	const rawPath = (item.workspacePath ?? item.path ?? "").trim();
	if (rawPath) {
		return toSettingsResourcePath(rawPath);
	}

	return item.name.trim();
}

/**
 * Map a discovered filesystem path to the form Pi settings usually stores:
 * `extensions/foo`, `../agent-workspace/pi/…`, or a relative path as-is.
 * Absolute home-dir paths are rejected (return empty) so they cannot be
 * committed for Vercel / shared deploys.
 */
export function toSettingsResourcePath(path: string) {
	const normalized = path.replace(/\\/g, "/");

	if (/^\/Users\//.test(normalized) || /^\/home\//.test(normalized)) {
		return "";
	}
	if (/^[A-Za-z]:\//.test(normalized)) {
		return "";
	}

	if (!normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized)) {
		// Catalog workspacePath values are repo-relative; Pi settings resolve
		// them from `.pi/`, so they need the `../` prefix.
		if (normalized.startsWith("agent-workspace/")) {
			return stripResourceFileSuffix(`../${normalized}`);
		}
		// Prefer canonical pi/ over legacy .pi/ under agent-workspace.
		if (normalized.startsWith("../agent-workspace/.pi/")) {
			return stripResourceFileSuffix(normalized.replace("../agent-workspace/.pi/", "../agent-workspace/pi/"));
		}
		return stripResourceFileSuffix(normalized);
	}

	const workspaceMatch = normalized.match(/\/(agent-workspace\/.+)$/);
	if (workspaceMatch?.[1]) {
		const workspacePath = workspaceMatch[1].replace(/^agent-workspace\/\.pi\//, "agent-workspace/pi/");
		return stripResourceFileSuffix(`../${workspacePath}`);
	}

	const piMatch = normalized.match(/\/\.pi\/(extensions\/.+|skills\/.+|prompts\/.+|themes\/.+)$/);
	if (piMatch?.[1]) {
		return stripResourceFileSuffix(piMatch[1]);
	}

	// Unrecognized absolute paths are not portable — do not persist them.
	return "";
}

function stripResourceFileSuffix(path: string) {
	return path.replace(/\/SKILL\.md$/i, "").replace(/\/index\.(ts|tsx|js|jsx|mjs|cjs)$/i, "");
}

/** True when `values` already contains an equivalent settings path. */
export function settingsResourceListIncludes(values: Array<string>, candidate: string) {
	const canonical = toSettingsResourcePath(candidate);
	return values.some((value) => toSettingsResourcePath(value) === canonical);
}

/**
 * Append a settings path only when no equivalent form is already present.
 * Stores the canonical form so later catalog options match.
 */
export function addUniqueSettingsResource(values: Array<string>, next: string): Array<string> {
	const trimmed = next.trim();
	if (!trimmed) return values;
	const canonical = toSettingsResourcePath(trimmed);
	if (!canonical) return values;
	if (settingsResourceListIncludes(values, canonical)) return values;
	return [...values, canonical];
}
