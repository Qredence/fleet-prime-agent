import { handleChatSettingsGet, handleChatSettingsPatch } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/settings")({
	server: {
		handlers: {
			GET: ({ request }) => handleChatSettingsGet(request),
			PATCH: ({ request }) => handleChatSettingsPatch(request),
		},
	},
});
