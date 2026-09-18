import {
	ComposerIntentCredentialSchema,
	ComposerIntentRequestSchema,
	ComposerIntentSettingsUpdateSchema,
} from "@prime-agent/web-protocol/chat-protocol.zod";
import type { ComposerIntentResponse, ComposerIntentSettings } from "@prime-agent/web-protocol/composer-intent";
import { readFleetSettings, updateFleetSettings } from "../fleet-settings";
import { getPrimeConfig } from "../prime-config";
import { clearStoredTypeSafeKey, typeSafeKeySource, writeStoredTypeSafeKey } from "../typesafe/credentials";
import { getTypeSafeService, resetTypeSafeService } from "../typesafe/singleton";
import { wrapApiHandler } from "../wrap-api-handler";

/**
 * Reads the Settings state.
 *
 * Reporting readiness costs a probe, so it is skipped entirely when nothing is
 * configured — there is nothing to verify and no reason to reach the network.
 * The projection never reveals the key, its value, or a raw transport error.
 */
async function composerIntentSettings(): Promise<ComposerIntentSettings> {
	const service = getTypeSafeService();
	const settings = await readFleetSettings(getPrimeConfig().agentDir);
	return {
		enabled: settings.composerIntentEnabled,
		status: service.configured ? await service.status() : "unconfigured",
		keySource: typeSafeKeySource(),
	};
}

/**
 * Reports availability to the Settings surface.
 *
 * `enabled` is the user's choice; `status` says whether the key can actually be
 * used. Neither reveals the key, its value, or a raw transport error.
 */
export function handleChatIntentGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => Response.json(await composerIntentSettings()), request);
}

/**
 * Stores or clears the TypeSafe API key.
 *
 * The key is write-only: it is never echoed back, in whole or in part. The
 * response is the same settings projection `GET` returns, so the caller learns
 * only whether a usable key now exists and where it came from.
 */
export function handleChatIntentPut(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = ComposerIntentCredentialSchema.parse(await request.json().catch(() => ({})));
		if (body.apiKey === null) clearStoredTypeSafeKey();
		else writeStoredTypeSafeKey(body.apiKey);
		// The service caches its config at construction, so this is what makes the
		// new key effective without restarting the process.
		resetTypeSafeService();
		return Response.json(await composerIntentSettings());
	}, request);
}

/** Turns the feature on or off. The Settings choice is the only opt-in. */
export function handleChatIntentPatch(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = ComposerIntentSettingsUpdateSchema.parse(await request.json().catch(() => ({})));
		await updateFleetSettings(getPrimeConfig().agentDir, { composerIntentEnabled: body.enabled });
		return Response.json(await composerIntentSettings());
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
