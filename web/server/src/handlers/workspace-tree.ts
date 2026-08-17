import { safePathLabel } from "../project-registry";
import { cwdForRequest } from "../project-request";
import { readWorkspaceTree } from "../workspace-tree";
import { wrapApiHandler } from "../wrap-api-handler";

export function handleWorkspaceTreeGet(_request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const root = await cwdForRequest(_request);
		const { nodes, diagnostics } = await readWorkspaceTree(root);
		// The browser only needs a display label. Keep the canonical project
		// directory server-owned; all tree/file paths remain workspace-relative.
		return Response.json({ root: safePathLabel(root), nodes, diagnostics });
	});
}
