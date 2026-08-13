import { getPrimeConfig } from "../prime-config";
import { readWorkspaceFile } from "../workspace-file";
import { wrapApiHandler } from "../wrap-api-handler";

export function handleWorkspaceFileGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const url = new URL(request.url);
		const path = url.searchParams.get("path") ?? "";
		const result = await readWorkspaceFile(getPrimeConfig().defaultCwd, path);
		if (result.kind === "error") {
			return Response.json({ message: result.message }, { status: result.status });
		}
		return Response.json(result.body);
	});
}
