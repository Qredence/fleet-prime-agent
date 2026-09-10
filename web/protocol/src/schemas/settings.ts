import {
	ChatDeliveryModeSchema,
	ChatThinkingLevelSchema,
	ChatTransportSchema,
	nonEmptyStringSchema,
	nonNegativeIntSchema,
	positiveIntSchema,
	z,
} from "./shared";

/**
 * Upper bound for a single code-load list (extension/skill/prompt/theme
 * paths, package sources). These settings turn into runtime module loads, so
 * the request shape stays capped instead of unbounded.
 */
export const MAX_CHAT_RESOURCE_ENTRIES = 100;

/**
 * Filesystem path or package spec for code-load settings (extensions,
 * skills, prompts, themes). Relative values such as `extensions/foo` and
 * `../agent-workspace/pi/skills` are legitimate: the settings UI emits them
 * via `toSettingsResourcePath`, and the response schema reuses this type
 * when loading existing settings. Only the shape is constrained here
 * (non-empty, bounded length, bounded list); containment is enforced where
 * the runtime resolves the paths.
 */
export const chatResourcePathSchema = nonEmptyStringSchema.max(1024);

const chatResourcePathArraySchema = z.array(chatResourcePathSchema).max(MAX_CHAT_RESOURCE_ENTRIES);

/**
 * Package source in the SettingsManager PackageSource shape: a bare spec
 * string, or an object filtering which resources load from `source`.
 */
export const ChatPackageSourceObjectSchema = z.object({
	source: nonEmptyStringSchema,
	extensions: z.array(nonEmptyStringSchema).optional(),
	skills: z.array(nonEmptyStringSchema).optional(),
	prompts: z.array(nonEmptyStringSchema).optional(),
	themes: z.array(nonEmptyStringSchema).optional(),
});

export const ChatPackageSourceSettingsSchema = z.union([nonEmptyStringSchema, ChatPackageSourceObjectSchema]);

const chatPackageSourceArraySchema = z.array(ChatPackageSourceSettingsSchema).max(MAX_CHAT_RESOURCE_ENTRIES);

export const ChatPiSettingsSchema = z
	.object({
		compaction: z.object({
			enabled: z.boolean(),
			reserveTokens: positiveIntSchema,
			keepRecentTokens: positiveIntSchema,
		}),
		defaultModel: z.string().optional(),
		defaultProvider: z.string().optional(),
		defaultThinkingLevel: ChatThinkingLevelSchema.optional(),
		enableSkillCommands: z.boolean(),
		enabledModels: z.array(nonEmptyStringSchema).optional(),
		extensions: chatResourcePathArraySchema,
		followUpMode: ChatDeliveryModeSchema,
		packages: chatPackageSourceArraySchema,
		prompts: chatResourcePathArraySchema,
		retry: z.object({
			enabled: z.boolean(),
			maxRetries: nonNegativeIntSchema,
			baseDelayMs: nonNegativeIntSchema,
		}),
		skills: chatResourcePathArraySchema,
		steeringMode: ChatDeliveryModeSchema,
		themes: chatResourcePathArraySchema,
		transport: ChatTransportSchema,
	})
	.openapi({ description: "Editable Pi settings" });

export const ChatPiSettingsUpdateSchema = z
	.object({
		compaction: ChatPiSettingsSchema.shape.compaction.partial().optional(),
		defaultModel: z.string().optional(),
		defaultProvider: z.string().optional(),
		defaultThinkingLevel: ChatThinkingLevelSchema.optional(),
		enableSkillCommands: z.boolean().optional(),
		enabledModels: z.array(nonEmptyStringSchema).nullable().optional(),
		extensions: chatResourcePathArraySchema.optional(),
		followUpMode: ChatDeliveryModeSchema.optional(),
		packages: chatPackageSourceArraySchema.optional(),
		prompts: chatResourcePathArraySchema.optional(),
		retry: ChatPiSettingsSchema.shape.retry.partial().optional(),
		skills: chatResourcePathArraySchema.optional(),
		steeringMode: ChatDeliveryModeSchema.optional(),
		themes: chatResourcePathArraySchema.optional(),
		transport: ChatTransportSchema.optional(),
	})
	.strict()
	.openapi({ description: "Pi settings update" });

export const ChatSettingsUpdateRequestSchema = z
	.object({
		settings: ChatPiSettingsUpdateSchema,
	})
	.openapi({ description: "Pi settings update request" });

export const ChatSettingsResponseSchema = z
	.object({
		diagnostics: z.array(z.string()),
		effective: ChatPiSettingsSchema,
		project: ChatPiSettingsUpdateSchema,
		projectPath: z.string(),
		updateImpact: z.object({
			newSessionRecommended: z.boolean(),
			resourceReloadRequired: z.boolean(),
		}),
	})
	.openapi({ description: "Pi settings response" });
