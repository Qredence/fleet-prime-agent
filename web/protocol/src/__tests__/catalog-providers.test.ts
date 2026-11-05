import { describe, expect, it } from "vitest";
import {
	ChatProviderInfoSchema,
	ChatProvidersResponseSchema,
	ChatProviderUpdateRequestSchema,
} from "../schemas/catalog";

describe("custom provider model catalog limits", () => {
	const largeModelIds = Array.from({ length: 95 }, (_, index) => `command-model-${index + 1}`);

	it("accepts provider info and update payloads with more than 64 model ids", () => {
		const provider = {
			id: "custom+command-code",
			name: "Command Code",
			isConfigured: true,
			envVarName: "COMMAND_CODE_API_KEY",
			modelIds: largeModelIds,
		};
		expect(ChatProviderInfoSchema.safeParse(provider).success).toBe(true);
		expect(
			ChatProvidersResponseSchema.safeParse({
				providers: [provider],
			}).success,
		).toBe(true);
		expect(
			ChatProviderUpdateRequestSchema.safeParse({
				providerId: "custom+command-code",
				apiKey: "secret",
				baseUrl: "https://example.com/v1",
				displayName: "Command Code",
				models: largeModelIds,
			}).success,
		).toBe(true);
	});

	it("still accepts modest catalogs unchanged", () => {
		const sixtyFive = Array.from({ length: 65 }, (_, index) => `model-${index}`);
		expect(
			ChatProviderInfoSchema.safeParse({
				id: "x",
				name: "x",
				isConfigured: true,
				envVarName: "X",
				modelIds: sixtyFive,
			}).success,
		).toBe(true);
	});
});
