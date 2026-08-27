import { mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import type {
	ProjectDirectoryBrowseResponse,
	ProjectDirectoryEntry,
	ProjectId,
	ProjectStatus,
	ProjectSummary,
} from "@prime-agent/web-protocol";

type ProjectRecord = {
	projectId: ProjectId;
	name: string;
	canonicalPath: string;
	createdAt: string;
	updatedAt: string;
	status: ProjectStatus;
};

type PersistedProjects = {
	version: 1;
	projects: ProjectRecord[];
	sessionAssignments: Record<string, ProjectId>;
};

type RegistryPersistence = {
	mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
	writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
	rename(oldPath: string, newPath: string): Promise<void>;
	unlink(path: string): Promise<void>;
};

const defaultPersistence: RegistryPersistence = {
	mkdir: (path, options) => mkdir(path, options),
	writeFile: (path, data, encoding) => writeFile(path, data, encoding),
	rename: (oldPath, newPath) => rename(oldPath, newPath),
	unlink: (path) => unlink(path),
};

type DirectoryToken = {
	path: string;
	expiresAt: number;
};

const TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_DIRECTORY_ENTRIES = 200;

class ProjectRegistryPersistenceError extends Error {
	constructor(operation: string, cause: unknown) {
		super(`Could not ${operation}. Please try again.`, { cause });
		this.name = "ProjectRegistryPersistenceError";
	}
}

function safePathLabel(path: string): string {
	const home = homedir();
	const homeRelative = path === home ? "~" : path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path;
	const pieces = homeRelative.split(sep).filter(Boolean);
	if (pieces.length <= 3) return homeRelative || sep;
	return `…${sep}${pieces.slice(-2).join(sep)}`;
}

function now(): string {
	return new Date().toISOString();
}

export class ProjectRegistry {
	readonly #filePath: string;
	readonly #initialPath: string;
	readonly #persistence: RegistryPersistence;
	readonly #directoryTokens = new Map<string, DirectoryToken>();
	#loading: Promise<void> | undefined;
	#projects = new Map<ProjectId, ProjectRecord>();
	#sessionAssignments = new Map<string, ProjectId>();
	#writeChain: Promise<void> = Promise.resolve();

	constructor(agentDir: string, initialCwd: string, persistence: RegistryPersistence = defaultPersistence) {
		this.#filePath = join(agentDir, "fleet-projects.json");
		this.#initialPath = resolve(initialCwd);
		this.#persistence = persistence;
	}

	async #ensureLoaded(): Promise<void> {
		let loading = this.#loading;
		if (!loading) {
			loading = this.#load().catch((error: unknown) => {
				this.#loading = undefined;
				throw error;
			});
			this.#loading = loading;
		}
		await loading;
	}

	async #load(): Promise<void> {
		await mkdir(dirname(this.#filePath), { recursive: true });
		try {
			const raw = JSON.parse(await readFile(this.#filePath, "utf8")) as Partial<PersistedProjects>;
			if (raw.version === 1 && Array.isArray(raw.projects)) {
				for (const project of raw.projects) {
					if (
						typeof project?.projectId === "string" &&
						typeof project.canonicalPath === "string" &&
						typeof project.name === "string" &&
						(project.status === "active" || project.status === "unregistered")
					) {
						this.#projects.set(project.projectId, project as ProjectRecord);
					}
				}
			}
			if (raw.sessionAssignments && typeof raw.sessionAssignments === "object") {
				for (const [sessionId, projectId] of Object.entries(raw.sessionAssignments)) {
					if (typeof projectId === "string") this.#sessionAssignments.set(sessionId, projectId);
				}
			}
		} catch {
			// A missing or corrupt registry is recoverable; the launch directory is
			// recreated as the initial project below.
		}

		const initial = await this.#canonicalDirectory(this.#initialPath).catch(() => undefined);
		if (initial && !this.#findByPath(initial)) {
			const timestamp = now();
			const project: ProjectRecord = {
				projectId: crypto.randomUUID(),
				name: basename(initial) || initial,
				canonicalPath: initial,
				createdAt: timestamp,
				updatedAt: timestamp,
				status: "active",
			};
			this.#projects.set(project.projectId, project);
			await this.#persist("initialize the project registry");
		}
	}

	async #persist(operation: string): Promise<void> {
		const snapshot: PersistedProjects = {
			version: 1,
			projects: [...this.#projects.values()],
			sessionAssignments: Object.fromEntries(this.#sessionAssignments),
		};
		const write = this.#writeChain
			.catch(() => undefined)
			.then(async () => {
				await this.#persistence.mkdir(dirname(this.#filePath), { recursive: true });
				const temporary = `${this.#filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
				try {
					await this.#persistence.writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
					await this.#persistence.rename(temporary, this.#filePath);
				} finally {
					await this.#persistence.unlink(temporary).catch(() => undefined);
				}
			});
		this.#writeChain = write;
		try {
			await write;
		} catch (error) {
			throw new ProjectRegistryPersistenceError(operation, error);
		}
	}

	async #canonicalDirectory(rawPath: string): Promise<string> {
		const candidate = rawPath.trim();
		if (!candidate || !isAbsolute(candidate)) throw new Error("Project path must be absolute");
		const canonical = await realpath(candidate);
		const info = await stat(canonical);
		if (!info.isDirectory()) throw new Error("Project path must be a directory");
		return canonical;
	}

	#findByPath(canonicalPath: string): ProjectRecord | undefined {
		return [...this.#projects.values()].find((project) => project.canonicalPath === canonicalPath);
	}

	#summary(project: ProjectRecord, sessionCount: number): ProjectSummary {
		return {
			projectId: project.projectId,
			name: project.name,
			pathLabel: safePathLabel(project.canonicalPath),
			createdAt: project.createdAt,
			updatedAt: project.updatedAt,
			sessionCount,
			status: project.status,
		};
	}

	async list(sessionCounts = new Map<ProjectId, number>()): Promise<ProjectSummary[]> {
		await this.#ensureLoaded();
		return [...this.#projects.values()]
			.filter((project) => project.status === "active")
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
			.map((project) => this.#summary(project, sessionCounts.get(project.projectId) ?? 0));
	}

	async get(projectId: ProjectId): Promise<ProjectRecord> {
		await this.#ensureLoaded();
		const project = this.#projects.get(projectId);
		if (project?.status !== "active") throw new Error("Unknown project");
		return project;
	}

	async getSummary(projectId: ProjectId, sessionCount = 0): Promise<ProjectSummary> {
		const project = await this.get(projectId);
		return this.#summary(project, sessionCount);
	}

	async register(rawPath: string, requestedName?: string): Promise<ProjectSummary> {
		await this.#ensureLoaded();
		const canonicalPath = await this.#canonicalDirectory(rawPath);
		const existing = this.#findByPath(canonicalPath);
		if (existing) {
			existing.status = "active";
			if (requestedName?.trim()) existing.name = requestedName.trim();
			existing.updatedAt = now();
			await this.#persist("save the project registration");
			return this.#summary(existing, this.#countSessions(existing.projectId));
		}
		const timestamp = now();
		const project: ProjectRecord = {
			projectId: crypto.randomUUID(),
			name: requestedName?.trim() || basename(canonicalPath) || canonicalPath,
			canonicalPath,
			createdAt: timestamp,
			updatedAt: timestamp,
			status: "active",
		};
		this.#projects.set(project.projectId, project);
		await this.#persist("save the project registration");
		return this.#summary(project, 0);
	}

	async rename(projectId: ProjectId, name: string): Promise<ProjectSummary> {
		await this.#ensureLoaded();
		const project = await this.get(projectId);
		project.name = name.trim();
		project.updatedAt = now();
		await this.#persist("save the project name");
		return this.#summary(project, this.#countSessions(project.projectId));
	}

	async unregister(projectId: ProjectId): Promise<ProjectSummary> {
		await this.#ensureLoaded();
		const project = await this.get(projectId);
		project.status = "unregistered";
		project.updatedAt = now();
		await this.#persist("save the project status");
		return this.#summary(project, this.#countSessions(project.projectId));
	}

	async projectIdForCwd(cwd: string): Promise<ProjectId | null> {
		await this.#ensureLoaded();
		if (!cwd.trim()) return null;
		const canonicalPath = await this.#canonicalDirectory(cwd).catch(() => undefined);
		if (!canonicalPath) return null;
		const project = this.#findByPath(canonicalPath);
		return project?.status === "active" ? project.projectId : null;
	}

	async projectIdForSession(sessionId: string, cwd: string): Promise<ProjectId | null> {
		await this.#ensureLoaded();
		const assigned = this.#sessionAssignments.get(sessionId);
		if (assigned && this.#projects.get(assigned)?.status === "active") return assigned;
		const projectId = await this.projectIdForCwd(cwd);
		if (projectId) {
			const previousProjectId = this.#sessionAssignments.get(sessionId);
			this.#sessionAssignments.set(sessionId, projectId);
			try {
				await this.#persist("save the session's project assignment");
			} catch (error) {
				if (previousProjectId === undefined) this.#sessionAssignments.delete(sessionId);
				else this.#sessionAssignments.set(sessionId, previousProjectId);
				throw error;
			}
		}
		return projectId;
	}

	async assignSession(sessionId: string, projectId: ProjectId | null): Promise<void> {
		await this.#ensureLoaded();
		if (projectId) await this.get(projectId);
		const previousProjectId = this.#sessionAssignments.get(sessionId);
		if (previousProjectId === projectId) return;

		if (projectId) this.#sessionAssignments.set(sessionId, projectId);
		else this.#sessionAssignments.delete(sessionId);

		try {
			await this.#persist("save the session's project assignment");
		} catch (error) {
			if (previousProjectId === undefined) this.#sessionAssignments.delete(sessionId);
			else this.#sessionAssignments.set(sessionId, previousProjectId);
			throw error;
		}
	}

	#countSessions(projectId: ProjectId): number {
		return [...this.#sessionAssignments.values()].filter((assigned) => assigned === projectId).length;
	}

	async browse(options: { path?: string; token?: string }): Promise<ProjectDirectoryBrowseResponse> {
		await this.#ensureLoaded();
		let path: string;
		if (options.token) {
			const token = this.#directoryTokens.get(options.token);
			if (!token || token.expiresAt < Date.now()) throw new Error("Directory token expired");
			path = token.path;
		} else {
			path = await this.#canonicalDirectory(options.path ?? this.#initialPath);
		}

		const entries = await readdir(path, { withFileTypes: true });
		const directories: ProjectDirectoryEntry[] = [];
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const child = resolve(path, entry.name);
			let isDirectory = entry.isDirectory();
			if (!isDirectory && entry.isSymbolicLink()) {
				isDirectory = await stat(child)
					.then((info) => info.isDirectory())
					.catch(() => false);
			}
			if (!isDirectory) continue;
			const canonical = await this.#canonicalDirectory(child).catch(() => undefined);
			if (!canonical) continue;
			const directoryToken = crypto.randomUUID();
			this.#directoryTokens.set(directoryToken, {
				path: canonical,
				expiresAt: Date.now() + TOKEN_TTL_MS,
			});
			directories.push({ directoryToken, name: entry.name, pathLabel: safePathLabel(canonical), hasChildren: true });
			if (directories.length >= MAX_DIRECTORY_ENTRIES) break;
		}
		const parentPath = dirname(path);
		const directoryToken = crypto.randomUUID();
		this.#directoryTokens.set(directoryToken, { path, expiresAt: Date.now() + TOKEN_TTL_MS });
		const parentToken = parentPath === path ? null : crypto.randomUUID();
		if (parentToken)
			this.#directoryTokens.set(parentToken, { path: parentPath, expiresAt: Date.now() + TOKEN_TTL_MS });
		return {
			pathLabel: safePathLabel(path),
			directoryToken,
			parentToken,
			entries: directories.sort((a, b) => a.name.localeCompare(b.name)),
		};
	}

	async resolveDirectoryInput(input: { path?: string; directoryToken?: string }): Promise<string> {
		if (input.directoryToken) {
			const token = this.#directoryTokens.get(input.directoryToken);
			if (!token || token.expiresAt < Date.now()) throw new Error("Directory token expired");
			return this.#canonicalDirectory(token.path);
		}
		if (!input.path) throw new Error("A project path is required");
		return this.#canonicalDirectory(input.path);
	}

	async summaryForCwd(cwd: string, sessionCount = 0): Promise<ProjectSummary | undefined> {
		await this.#ensureLoaded();
		const projectId = await this.projectIdForCwd(cwd);
		if (!projectId) return undefined;
		return this.getSummary(projectId, sessionCount);
	}

	/** Server-only path resolution for handlers and workspace loaders. */
	async cwdForProject(projectId: ProjectId): Promise<string> {
		return (await this.get(projectId)).canonicalPath;
	}
}

export { safePathLabel };
