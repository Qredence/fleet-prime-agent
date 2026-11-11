import { z } from "./shared";

export const ErrorResponseSchema = z.object({
	message: z.string(),
});

export const HealthResponseSchema = z.object({
	status: z.literal("ok"),
});
