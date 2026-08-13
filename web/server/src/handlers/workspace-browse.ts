import { getPrimeConfig } from "../prime-config";
import { browseWorkspaceDirectories } from "../workspace-browse";
import { wrapApiHandler } from "../wrap-api-handler";

export function handleWorkspaceBrowseGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const url = new URL(request.url);
		const pathParam = url.searchParams.get("path");
		const path = pathParam && pathParam.trim().length > 0 ? pathParam : getPrimeConfig().defaultCwd;
		const result = await browseWorkspaceDirectories(path);
		if (result.kind === "error") {
			return Response.json({ message: result.message }, { status: result.status });
		}
		return Response.json({
			path: result.path,
			parent: result.parent,
			entries: result.entries,
		});
	});
}
