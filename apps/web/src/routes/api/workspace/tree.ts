import { createFileRoute } from "@tanstack/react-router"
import { wrapApiHandler } from "@/lib/api-utils"
import { getPrimeConfig } from "@/server/prime-config"
import { readWorkspaceTree } from "@/server/workspace-tree"

// GET /api/workspace/tree — shallow read of the workspace root (git repo root
// when available; see resolveDefaultWorkspaceRoot). Read-only; no file watching.
// File contents are served by GET /api/workspace/file. Returns
// {root, nodes, diagnostics}.
export const Route = createFileRoute("/api/workspace/tree")({
	server: {
		handlers: {
			GET: async () =>
				wrapApiHandler(async () => {
					const root = getPrimeConfig().defaultCwd
					const { nodes, diagnostics } = await readWorkspaceTree(root)
					return Response.json({ root, nodes, diagnostics })
				}),
		},
	},
})
