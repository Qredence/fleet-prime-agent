import { cwdForRequest } from "../project-request";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

export function handleHealthGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const bridge = getBridge();
		const kernel = bridge.kernelReadyState(await cwdForRequest(request));
		return Response.json({
			ok: true,
			kernel,
			uptimeMs: process.uptime() * 1_000,
		});
	});
}
