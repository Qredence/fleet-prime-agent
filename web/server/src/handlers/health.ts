import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

export function handleHealthGet(_request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const bridge = getBridge();
		const kernel = bridge.kernelReadyState();
		return Response.json({
			ok: true,
			kernel,
			uptimeMs: process.uptime() * 1_000,
		});
	});
}
