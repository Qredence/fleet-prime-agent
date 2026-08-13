import { getPrimeConfig } from "../prime-config";
import { readWorkspaceTree } from "../workspace-tree";
import { wrapApiHandler } from "../wrap-api-handler";

export function handleWorkspaceTreeGet(_request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const root = getPrimeConfig().defaultCwd;
		const { nodes, diagnostics } = await readWorkspaceTree(root);
		return Response.json({ root, nodes, diagnostics });
	});
}
