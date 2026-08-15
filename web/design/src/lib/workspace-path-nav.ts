export type WorkspacePanelTarget = {
	panel: "artifacts" | "workspace";
	path: string;
};

const WORKSPACE_ROOT = "agent-workspace";
const ARTIFACTS_SEGMENT = `${WORKSPACE_ROOT}/artifacts`;

export const WORKSPACE_ARTIFACTS_SCOPE = ARTIFACTS_SEGMENT;

function collapseWorkspaceSegments(path: string): string {
	const stack: Array<string> = [];
	for (const segment of path.split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			stack.pop();
			continue;
		}
		stack.push(segment);
	}
	return stack.join("/");
}

export function isPathWithinScope(path: string, scopePath: string | null | undefined): boolean {
	if (!scopePath) return true;
	return path === scopePath || path.startsWith(`${scopePath}/`);
}

export function stripSandboxPrefixes(filePath: string): string {
	const prefixes = ["/project/sandbox/repo/", "/project/sandbox/", "/project/", "/workspace/"];
	for (const prefix of prefixes) {
		if (filePath.startsWith(prefix)) return filePath.slice(prefix.length);
	}

	const worktreeMarker = ".21st/worktrees/";
	const markerIndex = filePath.indexOf(worktreeMarker);
	if (markerIndex !== -1) {
		const rest = filePath.slice(markerIndex + worktreeMarker.length);
		const segments = rest.split("/");
		if (segments.length >= 3 && segments[0] && segments[1]) {
			return segments.slice(2).join("/");
		}
	}

	return filePath;
}

function findWorkspaceRootIndex(segments: Array<string>): number {
	return segments.indexOf(WORKSPACE_ROOT);
}

export function normalizeWorkspaceFilePath(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	const stripped = stripSandboxPrefixes(trimmed);
	const normalized = stripped.replace(/\\/g, "/").replace(/\/+/g, "/");

	if (normalized.startsWith(`${WORKSPACE_ROOT}/`)) {
		const collapsed = collapseWorkspaceSegments(normalized);
		return collapsed.startsWith(`${WORKSPACE_ROOT}/`) ? collapsed : null;
	}

	if (normalized === WORKSPACE_ROOT) {
		return null;
	}

	if (normalized.startsWith("artifacts/")) {
		return `${WORKSPACE_ROOT}/${normalized}`;
	}

	if (normalized.startsWith("/")) {
		const segments = normalized.split("/").filter(Boolean);
		const rootIndex = findWorkspaceRootIndex(segments);
		if (rootIndex >= 0) {
			return segments.slice(rootIndex).join("/");
		}
		return null;
	}

	return null;
}

export function resolveWorkspacePanelTarget(rawPath: string): WorkspacePanelTarget | null {
	const path = normalizeWorkspaceFilePath(rawPath);
	if (!path) return null;

	if (path.startsWith(`${ARTIFACTS_SEGMENT}/`) || path === ARTIFACTS_SEGMENT) {
		return { panel: "artifacts", path };
	}

	return { panel: "workspace", path };
}

export function extractWorkspaceFilePathFromToolInput(input: Record<string, unknown> | undefined): string | null {
	if (!input) return null;

	const filePath =
		typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : null;

	return filePath;
}

export function resolveWorkspacePathFromToolInput(
	input: Record<string, unknown> | undefined,
): WorkspacePanelTarget | null {
	const raw = extractWorkspaceFilePathFromToolInput(input);
	return raw ? resolveWorkspacePanelTarget(raw) : null;
}
