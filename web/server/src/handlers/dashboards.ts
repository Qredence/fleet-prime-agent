import { OpenUIApiError, ToolExecutionError } from "@openuidev/server";
import { DashboardSettingsUpdateSchema, type DashboardStatus } from "@prime-agent/web-protocol/dashboards";
import { configuredDashboardService } from "../dashboards/cloud";
import {
	clearStoredDashboardModel,
	clearStoredThesysKey,
	resolveDashboardModel,
	thesysKeySource,
	writeStoredDashboardModel,
	writeStoredThesysKey,
} from "../dashboards/credentials";
import { findEditableDashboard, storedRecord } from "../dashboards/settle";
import { dashboardUserId } from "../dashboards/user-id";
import { wrapApiHandler } from "../wrap-api-handler";
import { requireSession } from "./session-access";

export { settleDashboardMessage } from "../dashboards/settle";

async function status(): Promise<DashboardStatus> {
	const keySource = await thesysKeySource();
	const mode = keySource === "none" ? "self-hosted" : "cloud";
	const { model, source } = await resolveDashboardModel();
	return { configured: mode === "cloud", keySource, mode, model, modelSource: source };
}

export function handleDashboardsGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => Response.json(await status()), request);
}

/**
 * Writes dashboard settings. Both fields are optional: the key is write-only, and
 * the model is a deployment choice that has to match the provider the key covers.
 */
export function handleDashboardsPut(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = DashboardSettingsUpdateSchema.parse(await request.json().catch(() => ({})));
		if (body.apiKey === null) await clearStoredThesysKey();
		else if (body.apiKey !== undefined) await writeStoredThesysKey(body.apiKey);
		if (body.model === null) await clearStoredDashboardModel();
		else if (body.model !== undefined) await writeStoredDashboardModel(body.model);
		return Response.json(await status());
	}, request);
}

export function handleDashboardsTokenPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const service = await configuredDashboardService();
		if (!service) return Response.json({ message: "A Thesys API key is required." }, { status: 404 });
		try {
			const token = await service.createFrontendToken(
				{ userId: await dashboardUserId() },
				{ signal: request.signal },
			);
			return Response.json(token, { headers: { "Cache-Control": "private, no-store" } });
		} catch (error) {
			const statusCode = error instanceof OpenUIApiError ? (error.status ?? 502) : 502;
			return Response.json({ message: "Could not create a frontend token." }, { status: statusCode });
		}
	}, request);
}

export function handleDashboardsInterpreterPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const url = new URL(request.url);
		const sessionId = url.searchParams.get("sessionId") ?? "";
		const dashboardId = url.searchParams.get("dashboardId") ?? "";
		const session = await requireSession(sessionId);
		if (!session) return Response.json({ message: "Unknown session." }, { status: 404 });
		try {
			const body = await request.json();
			const service = await configuredDashboardService();
			if (!service) return Response.json({ message: "A Thesys API key is required." }, { status: 404 });
			const artifact = dashboardId ? findEditableDashboard(session.sessionId, dashboardId) : undefined;
			const dataset = artifact ? storedRecord(artifact)?.dataset : undefined;
			const result = await service.interpreter.execute(
				body,
				{ userId: await dashboardUserId(), sessionId: session.sessionId, dashboardId, dataset },
				{ signal: request.signal },
			);
			return Response.json({ result });
		} catch (error) {
			const known = error instanceof ToolExecutionError || error instanceof OpenUIApiError;
			return Response.json(
				{
					error: {
						code: known ? error.code : "internal_error",
						message: "Dashboard data failed.",
					},
				},
				{ status: known ? (error.status ?? 500) : 500 },
			);
		}
	}, request);
}
