import { SessionIdSchema } from "../fleet-contract";
import { z } from "./shared";

export const SessionTreeNodeRoleSchema = z.enum(["user", "assistant", "system", "unknown"]);

export const SessionTreeNodeKindSchema = z.enum(["message", "system", "other"]);

export const SessionTreeNodeSchema: z.ZodType<SessionTreeNode> = z.lazy(() =>
	z
		.object({
			id: z.string().min(1),
			parentId: z.string().min(1).optional(),
			kind: SessionTreeNodeKindSchema,
			role: SessionTreeNodeRoleSchema.optional(),
			label: z.string(),
			preview: z.string(),
			isLeaf: z.boolean(),
			isOnActiveBranch: z.boolean(),
			messageIndex: z.number().int().nonnegative().optional(),
			children: z.array(SessionTreeNodeSchema),
		})
		.openapi({ description: "Browser-safe session tree node" }),
);

export type SessionTreeNodeRole = z.infer<typeof SessionTreeNodeRoleSchema>;
export type SessionTreeNodeKind = z.infer<typeof SessionTreeNodeKindSchema>;
export type SessionTreeNode = {
	id: string;
	parentId?: string;
	kind: SessionTreeNodeKind;
	role?: SessionTreeNodeRole;
	label: string;
	preview: string;
	isLeaf: boolean;
	isOnActiveBranch: boolean;
	messageIndex?: number;
	children: Array<SessionTreeNode>;
};

export const SessionTreeSnapshotSchema = z
	.object({
		sessionId: SessionIdSchema,
		leafId: z.string().min(1).nullable(),
		nodes: z.array(SessionTreeNodeSchema),
	})
	.openapi({ description: "Session entry tree snapshot for the active branch and branches" });

export type SessionTreeSnapshot = z.infer<typeof SessionTreeSnapshotSchema>;

export const SessionTreeSnapshotResponseSchema = z
	.object({
		snapshot: SessionTreeSnapshotSchema,
	})
	.openapi({ description: "Session tree read response" });

export type SessionTreeSnapshotResponse = z.infer<typeof SessionTreeSnapshotResponseSchema>;

export const SessionTreeNavigateRequestSchema = z
	.object({
		sessionId: SessionIdSchema,
		targetEntryId: z.string().min(1).max(256),
		expectedLeafId: z.string().min(1).max(256).optional(),
	})
	.openapi({ description: "Navigate the live session tree to an earlier entry" });

export type SessionTreeNavigateRequest = z.infer<typeof SessionTreeNavigateRequestSchema>;

export const SessionTreeNavigateResponseSchema = z
	.object({
		snapshot: SessionTreeSnapshotSchema,
	})
	.openapi({ description: "Session tree navigate response with authoritative snapshot" });

export type SessionTreeNavigateResponse = z.infer<typeof SessionTreeNavigateResponseSchema>;
