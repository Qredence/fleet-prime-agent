import {
	ChatDeliveryModeSchema,
	ChatPackageSourceSchema,
	ChatThinkingLevelSchema,
	ChatTransportSchema,
	nonEmptyStringSchema,
	nonNegativeIntSchema,
	positiveIntSchema,
	z,
} from "./shared";

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
		extensions: z.array(nonEmptyStringSchema),
		followUpMode: ChatDeliveryModeSchema,
		packages: z.array(ChatPackageSourceSchema),
		prompts: z.array(nonEmptyStringSchema),
		retry: z.object({
			enabled: z.boolean(),
			maxRetries: nonNegativeIntSchema,
			baseDelayMs: nonNegativeIntSchema,
		}),
		skills: z.array(nonEmptyStringSchema),
		steeringMode: ChatDeliveryModeSchema,
		themes: z.array(nonEmptyStringSchema),
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
		extensions: z.array(nonEmptyStringSchema).optional(),
		followUpMode: ChatDeliveryModeSchema.optional(),
		packages: z.array(ChatPackageSourceSchema).optional(),
		prompts: z.array(nonEmptyStringSchema).optional(),
		retry: ChatPiSettingsSchema.shape.retry.partial().optional(),
		skills: z.array(nonEmptyStringSchema).optional(),
		steeringMode: ChatDeliveryModeSchema.optional(),
		themes: z.array(nonEmptyStringSchema).optional(),
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
