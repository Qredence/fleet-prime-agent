import { z } from "zod/v4";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_TURN_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export const RightPanelIdSchema = z.enum(["resources", "workspace", "artifacts", "session-insights"]);
export type RightPanelId = z.infer<typeof RightPanelIdSchema>;
export type RightPanelState = RightPanelId | null;

export const SessionIdSchema = z
	.string()
	.min(1)
	.max(160)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

/** Opaque server-owned project identifier. The browser must never infer a path from it. */
export const ProjectIdSchema = z
	.string()
	.min(1)
	.max(160)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export type ProjectId = z.infer<typeof ProjectIdSchema>;

export const ProjectStatusSchema = z.enum(["active", "unregistered"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSummarySchema = z.object({
	projectId: ProjectIdSchema,
	name: z.string().min(1).max(256),
	pathLabel: z.string().min(1).max(1024),
	createdAt: z.string(),
	updatedAt: z.string(),
	sessionCount: z.number().int().nonnegative(),
	status: ProjectStatusSchema,
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectDirectoryEntrySchema = z.object({
	directoryToken: z.string().min(1).max(512),
	name: z.string().min(1).max(256),
	pathLabel: z.string().min(1).max(1024),
	hasChildren: z.boolean(),
});
export type ProjectDirectoryEntry = z.infer<typeof ProjectDirectoryEntrySchema>;

export const ProjectDirectoryBrowseResponseSchema = z.object({
	pathLabel: z.string().min(1).max(1024),
	directoryToken: z.string().min(1).max(512),
	parentToken: z.string().min(1).max(512).nullable(),
	entries: z.array(ProjectDirectoryEntrySchema),
});
export type ProjectDirectoryBrowseResponse = z.infer<typeof ProjectDirectoryBrowseResponseSchema>;

export const ProjectListResponseSchema = z.object({
	projects: z.array(ProjectSummarySchema),
	sessions: z.array(
		z.object({
			sessionId: SessionIdSchema,
			projectId: ProjectIdSchema.nullable(),
			title: z.string(),
			createdAt: z.string(),
			updatedAt: z.string(),
			status: z.enum(["idle", "running", "interrupted", "failed"]),
			messageCount: z.number().int().nonnegative(),
			firstMessage: z.string(),
		}),
	),
});
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;

export const ProjectCreateRequestSchema = z
	.object({
		path: z.string().min(1).max(4096).optional(),
		directoryToken: z.string().min(1).max(512).optional(),
		name: z.string().trim().min(1).max(256).optional(),
	})
	.refine((value) => value.path !== undefined || value.directoryToken !== undefined, {
		message: "A path or directory token is required",
	});
export type ProjectCreateRequest = z.infer<typeof ProjectCreateRequestSchema>;

export const ProjectRenameRequestSchema = z.object({
	name: z.string().trim().min(1).max(256),
});
export type ProjectRenameRequest = z.infer<typeof ProjectRenameRequestSchema>;

export const ProjectForkRequestSchema = z.object({
	sessionId: SessionIdSchema,
	targetProjectId: ProjectIdSchema,
});
export type ProjectForkRequest = z.infer<typeof ProjectForkRequestSchema>;

export const ProjectForkResponseSchema = z.object({
	sessionId: SessionIdSchema,
	projectId: ProjectIdSchema,
});
export type ProjectForkResponse = z.infer<typeof ProjectForkResponseSchema>;

export const WorkspaceRelativePathSchema = z
	.string()
	.max(4096)
	.transform((value) => value.replaceAll("\\", "/"))
	.pipe(
		z
			.string()
			.refine(
				(value) =>
					value !== "" &&
					!value.startsWith("/") &&
					!value.includes("\0") &&
					!value.split("/").some((segment) => segment === ".."),
				"Expected a contained workspace-relative path",
			),
	);

export const SessionRefSchema = z.object({ sessionId: SessionIdSchema });
export type SessionRef = z.infer<typeof SessionRefSchema>;

export const SessionSummarySchema = z.object({
	sessionId: SessionIdSchema,
	projectId: ProjectIdSchema.nullable().optional(),
	title: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	status: z.enum(["idle", "running", "interrupted", "failed"]),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const OpenPanelActionSchema = z
	.object({
		panel: RightPanelIdSchema,
		projectId: ProjectIdSchema.optional(),
		relativePath: WorkspaceRelativePathSchema.optional(),
		focus: z.boolean().optional(),
	})
	.superRefine((action, ctx) => {
		if (action.relativePath !== undefined && action.panel !== "workspace" && action.panel !== "artifacts") {
			ctx.addIssue({
				code: "custom",
				path: ["relativePath"],
				message: "relativePath is only valid for workspace and artifacts panels",
			});
		}
	});
export type OpenPanelAction = z.infer<typeof OpenPanelActionSchema>;

export const WorkspaceAttachmentSchema = z.object({
	kind: z.literal("workspace"),
	relativePath: WorkspaceRelativePathSchema,
	name: z.string().min(1).max(512),
	mimeType: z.string().max(255).optional(),
});
export type WorkspaceAttachment = z.infer<typeof WorkspaceAttachmentSchema>;

export const UploadedAttachmentSchema = z.object({
	kind: z.literal("upload"),
	attachmentId: z.uuid(),
	name: z.string().min(1).max(512),
	mimeType: z.string().min(1).max(255),
	size: z.number().int().nonnegative().max(MAX_ATTACHMENT_BYTES),
});
export type UploadedAttachment = z.infer<typeof UploadedAttachmentSchema>;

export const ChatAttachmentSchema = z.discriminatedUnion("kind", [WorkspaceAttachmentSchema, UploadedAttachmentSchema]);
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

const MessageIdSchema = z.string().min(1).max(160);

export const ChatToolPartSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("shell"),
		command: z.string(),
		output: z.string().optional(),
		exitCode: z.number().int().optional(),
	}),
	z.object({
		kind: z.literal("ipython"),
		code: z.string(),
		output: z.string().optional(),
	}),
	z.object({
		kind: z.literal("file"),
		operation: z.enum(["read", "write", "edit", "delete"]),
		relativePath: WorkspaceRelativePathSchema,
		diff: z.string().optional(),
	}),
	z.object({
		kind: z.literal("search"),
		query: z.string(),
		results: z.array(z.object({ title: z.string(), url: z.url().optional() })).optional(),
	}),
	z.object({
		kind: z.literal("mcp"),
		server: z.string(),
		tool: z.string(),
		input: z.unknown().optional(),
		output: z.unknown().optional(),
	}),
	z.object({
		kind: z.literal("plan"),
		title: z.string().optional(),
		steps: z.array(z.object({ text: z.string(), status: z.string() })),
	}),
	z.object({
		kind: z.literal("todo"),
		items: z.array(z.object({ text: z.string(), completed: z.boolean() })),
	}),
	z.object({
		kind: z.literal("generic"),
		name: z.string(),
		input: z.unknown().optional(),
		output: z.unknown().optional(),
	}),
]);
export type ChatToolPart = z.infer<typeof ChatToolPartSchema>;

const ChatPlanPartSchema = ChatToolPartSchema.options[5];
const ChatTodoPartSchema = ChatToolPartSchema.options[6];

export const ChatEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("text"), messageId: MessageIdSchema, text: z.string(), delta: z.boolean().optional() }),
	z.object({
		type: z.literal("reasoning"),
		messageId: MessageIdSchema,
		text: z.string(),
		delta: z.boolean().optional(),
	}),
	z.object({ type: z.literal("lifecycle"), phase: z.string(), label: z.string().optional() }),
	z.object({
		type: z.literal("tool"),
		toolCallId: MessageIdSchema,
		status: z.enum(["pending", "running", "complete", "error"]),
		part: ChatToolPartSchema,
	}),
	z.object({
		type: z.literal("approval"),
		approvalId: MessageIdSchema,
		toolCallId: MessageIdSchema.optional(),
		title: z.string(),
		detail: z.string().optional(),
	}),
	z.object({
		type: z.literal("question"),
		questionId: MessageIdSchema,
		title: z.string(),
		options: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
	}),
	z.object({ type: z.literal("plan"), plan: ChatPlanPartSchema }),
	z.object({ type: z.literal("todo"), todo: ChatTodoPartSchema }),
	z.object({
		type: z.literal("citation"),
		messageId: MessageIdSchema,
		citationId: MessageIdSchema,
		title: z.string(),
		url: z.url().optional(),
	}),
	z.object({ type: z.literal("attachment"), messageId: MessageIdSchema, attachment: ChatAttachmentSchema }),
	z.object({ type: z.literal("openui"), messageId: MessageIdSchema, payload: z.unknown(), final: z.boolean() }),
	z.object({ type: z.literal("completion"), reason: z.string().optional() }),
	z.object({ type: z.literal("interruption"), reason: z.string(), retryable: z.boolean() }),
	z.object({ type: z.literal("error"), code: z.string(), message: z.string(), retryable: z.boolean().optional() }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

export const OpenUIActionSchema = z.object({
	sessionId: SessionIdSchema,
	messageId: z.string().min(1).max(160),
	componentId: z.string().min(1).max(160),
	actionId: z.string().min(1).max(160),
	payload: z.unknown(),
});
export type OpenUIAction = z.infer<typeof OpenUIActionSchema>;

export const AttachmentUploadMetadataSchema = z.object({
	sessionId: SessionIdSchema,
	name: z.string().min(1).max(512),
	mimeType: z.string().min(1).max(255),
	size: z.number().int().nonnegative().max(MAX_ATTACHMENT_BYTES),
});
export type AttachmentUploadMetadata = z.infer<typeof AttachmentUploadMetadataSchema>;
