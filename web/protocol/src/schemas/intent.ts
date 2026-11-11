import { ProjectIdSchema } from "../fleet-contract";
import { nonEmptyStringSchema, z } from "./shared";

export const ComposerIntentStatusSchema = z.enum(["unconfigured", "unverified", "ready", "error"]);

export const ComposerIntentReasonSchema = z.enum([
	"disabled",
	"not_ready",
	"empty",
	"no_match",
	"code_task",
	"below_floor",
	"unavailable",
	"rate_limited",
]);

export const ComposerIntentKeySourceSchema = z.enum(["settings", "environment", "none"]);

export const ComposerIntentDispositionSchema = z.enum(["execute", "suggest"]);

export const ComposerIntentRequestSchema = z.object({
	text: nonEmptyStringSchema.max(2_000),
	projectId: ProjectIdSchema.optional(),
});

export const ComposerIntentResponseSchema = z.object({
	enabled: z.boolean(),
	outcome: z.enum(["none", "matched"]),
	command: z.string().min(1).max(64).optional(),
	confidence: z.number().min(0).max(1).optional(),
	disposition: ComposerIntentDispositionSchema.optional(),
	reason: ComposerIntentReasonSchema.optional(),
	model: z.string().max(120).optional(),
	latencyMs: z.number().nonnegative().optional(),
});

export const ComposerIntentSettingsSchema = z.object({
	/** The user's choice in Settings. Off until they turn it on. */
	enabled: z.boolean(),
	/** Whether a usable key is present. `unverified` until a probe succeeds. */
	status: ComposerIntentStatusSchema,
	keySource: ComposerIntentKeySourceSchema,
});

export const ComposerIntentCredentialSchema = z.object({
	/** A key to store, or null to remove the stored one. */
	apiKey: nonEmptyStringSchema.max(400).nullable(),
});

export const ComposerIntentSettingsUpdateSchema = z.object({
	enabled: z.boolean(),
});
