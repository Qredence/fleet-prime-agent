import { ProjectIdSchema } from "../fleet-contract";
import { nonEmptyStringSchema, z } from "./shared";

export const ComposerCompletionRequestSchema = z
	.object({
		text: nonEmptyStringSchema.max(2_000),
		projectId: ProjectIdSchema.optional(),
	})
	.openapi({ description: "Composer ghost-text completion request" });

export const ComposerCompletionResponseSchema = z
	.object({
		completion: z.string().min(1).max(2_000).optional(),
	})
	.openapi({ description: "Composer ghost-text completion; a verbatim string, never model prose" });
