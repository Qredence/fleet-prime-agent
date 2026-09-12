import type { ProjectId } from "@prime-agent/web-protocol";
import { ProjectIdSchema } from "@prime-agent/web-protocol";
import { getPrimeConfig } from "./prime-config";

/** Resolve an HTTP request's project ID to a server-owned canonical cwd. */
export async function cwdForRequest(request: Request): Promise<string> {
	const projectIdParam = new URL(request.url).searchParams.get("projectId");
	if (!projectIdParam) return getPrimeConfig().defaultCwd;
	const projectId = ProjectIdSchema.parse(projectIdParam) as ProjectId;
	return getPrimeConfig().projectRegistry.cwdForProject(projectId);
}
