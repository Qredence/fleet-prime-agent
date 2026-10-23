import { wrapApiHandler } from "../wrap-api-handler";

export function handleHealthGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		return Response.json({
			ok: true,
			uptimeMs: process.uptime() * 1_000,
		});
	}, request);
}
