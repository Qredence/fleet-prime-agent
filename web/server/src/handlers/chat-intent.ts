import {
	ComposerIntentRequestSchema,
	ComposerIntentSettingsUpdateSchema,
} from "@prime-agent/web-protocol/chat-protocol.zod";
import type { ComposerIntentResponse } from "@prime-agent/web-protocol/composer-intent";
import { readFleetSettings, updateFleetSettings } from "../fleet-settings";
import { getPrimeConfig } from "../prime-config";
import { getTypeSafeService } from "../typesafe/singleton";
import { wrapApiHandler } from "../wrap-api-handler";

/**
 * Reports availability to the Settings surface.
 *
 * `enabled` is the user's choice; `status` says whether the key can actually be
 * used. Neither reveals the key, its value, or a raw transport error.
 */
export function handleChatIntentGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const service = getTypeSafeService();
		const settings = await readFleetSettings(getPrimeConfig().agentDir);
		const status = service.configured ? await service.status() : "unconfigured";
		return Response.json({ enabled: settings.composerIntentEnabled, status });
	}, request);
}

/** Turns the feature on or off. The Settings choice is the only opt-in. */
export function handleChatIntentPatch(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = ComposerIntentSettingsUpdateSchema.parse(await request.json().catch(() => ({})));
		const settings = await updateFleetSettings(getPrimeConfig().agentDir, {
			composerIntentEnabled: body.enabled,
		});
		const service = getTypeSafeService();
		const status = service.configured ? await service.status() : "unconfigured";
		return Response.json({ enabled: settings.composerIntentEnabled, status });
	}, request);
}

/**
 * Routes a composer draft to a built-in command, or declines to.
 *
 * Declining is the common case and the safe one: the browser sends the draft to
 * the agent exactly as it would have without this route. Every failure mode —
 * unconfigured, disabled in Settings, timeout, rate limit, unusable answer —
 * produces `outcome: "none"`.
 *
 * The response never carries model prose, instructions, probabilities, or error
 * text, so nothing new about the model call reaches the browser.
 */
export function handleChatIntentPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = ComposerIntentRequestSchema.parse(await request.json().catch(() => ({})));
		const service = getTypeSafeService();
		if (!service.configured) {
			return Response.json({
				enabled: false,
				outcome: "none",
				reason: "disabled",
			} satisfies ComposerIntentResponse);
		}
		const settings = await readFleetSettings(getPrimeConfig().agentDir);
		const response = await service.routeComposerIntent(body, settings.composerIntentEnabled);
		return Response.json(response);
	}, request);
}
