import { ProjectIdSchema } from "../fleet-contract";
import { nonEmptyStringSchema, z } from "./shared";

export const ComposerIntentStatusSchema = z
	.enum(["unconfigured", "unverified", "ready", "error"])
	.openapi({ description: "Coarse readiness of the optional composer intent classifier" });

export const ComposerIntentReasonSchema = z
	.enum(["disabled", "not_ready", "empty", "no_match", "code_task", "below_floor", "unavailable", "rate_limited"])
	.openapi({ description: "Why a routing attempt produced no action" });

export const ComposerIntentKeySourceSchema = z
	.enum(["settings", "environment", "none"])
	.openapi({ description: "Which key the classifier is using; never the key itself" });

export const ComposerIntentDispositionSchema = z
	.enum(["execute", "suggest"])
	.openapi({ description: "Whether a matched command may run automatically or is only offered" });

export const ComposerIntentRequestSchema = z
	.object({
		text: nonEmptyStringSchema.max(2_000),
		projectId: ProjectIdSchema.optional(),
	})
	.openapi({ description: "Composer free-text intent routing request" });

export const ComposerIntentResponseSchema = z
	.object({
		enabled: z.boolean(),
		outcome: z.enum(["none", "matched"]),
		command: z.string().min(1).max(64).optional(),
		confidence: z.number().min(0).max(1).optional(),
		disposition: ComposerIntentDispositionSchema.optional(),
		reason: ComposerIntentReasonSchema.optional(),
		model: z.string().max(120).optional(),
		latencyMs: z.number().nonnegative().optional(),
	})
	.openapi({ description: "Composer intent routing decision; never carries model prose or error text" });

export const ComposerIntentSettingsSchema = z
	.object({
		/** The user's choice in Settings. Off until they turn it on. */
		enabled: z.boolean(),
		/** Whether a usable key is present. `unverified` until a probe succeeds. */
		status: ComposerIntentStatusSchema,
		keySource: ComposerIntentKeySourceSchema,
	})
	.openapi({ description: "Composer intent routing availability; never reveals the key or a raw error" });

export const ComposerIntentCredentialSchema = z
	.object({
		/** A key to store, or null to remove the stored one. */
		apiKey: nonEmptyStringSchema.max(400).nullable(),
	})
	.openapi({ description: "Set or clear the stored classifier key; write-only" });

export const ComposerIntentSettingsUpdateSchema = z
	.object({
		enabled: z.boolean(),
	})
	.openapi({ description: "Enable or disable composer intent routing" });
