import { wrapApiHandler } from "../wrap-api-handler";

export function handleWorkspaceBrowseGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		void request;
		return Response.json(
			{ message: "Workspace root switching is disabled; use /api/projects/browse for opaque directory tokens." },
			{ status: 410 },
		);
	});
}
