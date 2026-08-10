import { z } from "./shared";

export const ErrorResponseSchema = z
	.object({
		message: z.string(),
	})
	.openapi({ description: "Error response" });

export const HealthResponseSchema = z
	.object({
		status: z.literal("ok"),
	})
	.openapi({ description: "Health check response" });
