import { ProjectIdSchema } from "../fleet-contract";
import { nonEmptyStringSchema, z } from "./shared";

export const ComposerCompletionSourceSchema = z
	.enum(["session", "corpus"])
	.openapi({ description: "Where a completion came from: this session or another session" });

/** Browser accept mode for inline ghosts. Not part of the history HTTP response. */
export const ComposerCompletionModeSchema = z
	.enum(["append", "replace"])
	.openapi({ description: "Whether accepting appends the completion or replaces the draft with it" });

export const ComposerCompletionRequestSchema = z
	.object({
		text: nonEmptyStringSchema.max(2_000),
		/** The session being typed in; its own prompts are preferred over the corpus. */
		sessionId: nonEmptyStringSchema.max(200).optional(),
		projectId: ProjectIdSchema.optional(),
	})
	.openapi({ description: "Composer ghost-text completion request" });

export const ComposerCompletionResponseSchema = z
	.object({
		completion: z.string().min(1).max(2_000).optional(),
		confidence: z.number().min(0).max(1).optional(),
		source: ComposerCompletionSourceSchema.optional(),
	})
	.openapi({
		description:
			"Composer ghost-text completion from history; a verbatim string that always extends the draft, never model prose",
	});
