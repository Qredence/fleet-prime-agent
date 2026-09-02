import {
	handleChatAttachmentGet,
	handleChatAttachmentsPost,
	handleChatPlanPresentationPut,
	handleChatQueueMutationPost,
	handleChatSessionGet,
} from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/session")({
	server: {
		handlers: {
			GET: ({ request }) =>
				new URL(request.url).searchParams.has("attachmentId")
					? handleChatAttachmentGet(request)
					: handleChatSessionGet(request),
			POST: ({ request }) => handleChatAttachmentsPost(request),
			PUT: ({ request }) => handleChatPlanPresentationPut(request),
			PATCH: ({ request }) => handleChatQueueMutationPost(request),
		},
	},
});
