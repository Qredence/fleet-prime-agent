import { type DashboardStatus, DashboardStatusSchema } from "@prime-agent/web-protocol/dashboards";
import { resolveChatApiUrl } from "@/lib/chat/chat-runtime-url";

async function readJson(response: Response): Promise<unknown> {
	return response.json().catch(() => null);
}

export async function fetchDashboardStatus(): Promise<DashboardStatus> {
	const response = await fetch(resolveChatApiUrl("/api/chat/dashboards"));
	const body = await readJson(response);
	const parsed = DashboardStatusSchema.safeParse(body);
	if (!response.ok || !parsed.success) throw new Error("Could not read dashboard settings.");
	return parsed.data;
}

export async function saveDashboardKey(apiKey: string | null): Promise<DashboardStatus> {
	return saveDashboardSettings({ apiKey });
}

/**
 * Writes dashboard settings. `null` clears a stored value; omitted fields are
 * left alone, so the key and the model can be changed independently.
 */
export async function saveDashboardSettings(update: {
	apiKey?: string | null;
	model?: string | null;
}): Promise<DashboardStatus> {
	const response = await fetch(resolveChatApiUrl("/api/chat/dashboards"), {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(update),
	});
	const body = await readJson(response);
	const parsed = DashboardStatusSchema.safeParse(body);
	if (!response.ok || !parsed.success) throw new Error("Could not save the dashboard settings.");
	return parsed.data;
}
