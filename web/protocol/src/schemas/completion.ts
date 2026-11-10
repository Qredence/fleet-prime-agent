import { ProjectIdSchema } from "../fleet-contract";
import { nonEmptyStringSchema, z } from "./shared";

export const ComposerCompletionSourceSchema = z.enum(["session", "corpus"]);

/** Browser accept mode for inline ghosts. Not part of the history HTTP response. */
export const ComposerCompletionModeSchema = z.enum(["append", "replace"]);

export const ComposerCompletionRequestSchema = z.object({
	text: nonEmptyStringSchema.max(2_000),
	/** The session being typed in; its own prompts are preferred over the corpus. */
	sessionId: nonEmptyStringSchema.max(200).optional(),
	projectId: ProjectIdSchema.optional(),
});

export const ComposerCompletionResponseSchema = z.object({
	completion: z.string().min(1).max(2_000).optional(),
	confidence: z.number().min(0).max(1).optional(),
	source: ComposerCompletionSourceSchema.optional(),
});
