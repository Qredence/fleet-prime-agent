import type { ProjectId } from "@prime-agent/web-protocol";
import type {
	ChatProviderOAuthLoginRequest,
	ChatProviderOAuthLoginResponse,
	ChatProviderRemoveRequest,
	ChatProviderRemoveResponse,
	ChatProviderUpdateRequest,
	ChatProviderUpdateResponse,
	ChatSettingsUpdateRequest,
} from "@prime-agent/web-protocol/chat-protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { chatClient } from "./chat-client";

export const chatQueryKeys = {
	models: (projectId?: ProjectId) => ["chat", "models", projectId ?? "default"] as const,
	modelCatalog: (projectId?: ProjectId) => ["chat", "models", "catalog", projectId ?? "default"] as const,
	providers: ["chat", "providers"] as const,
	resources: (projectId?: ProjectId) => ["chat", "resources", projectId ?? "default"] as const,
	commands: (projectId?: ProjectId) => ["chat", "commands", projectId ?? "default"] as const,
	settings: (projectId?: ProjectId) => ["chat", "settings", projectId ?? "default"] as const,
	workspace: (projectId?: ProjectId) => ["workspace", "tree", projectId ?? "default"] as const,
	projects: ["projects"] as const,
} as const;

const keys = chatQueryKeys;

export function useChatModels(projectId?: ProjectId) {
	return useQuery({
		queryKey: keys.models(projectId),
		queryFn: () => chatClient.getModels({ projectId }),
	});
}

export function useChatProjects() {
	return useQuery({
		queryKey: keys.projects,
		queryFn: () => chatClient.listProjects(),
		staleTime: 5_000,
	});
}

export function useChatModelCatalog(options?: { enabled?: boolean; projectId?: ProjectId }) {
	return useQuery({
		queryKey: keys.modelCatalog(options?.projectId),
		queryFn: () => chatClient.getModels({ scope: "all", projectId: options?.projectId }),
		enabled: options?.enabled,
	});
}

export function useDiscoverChatModels() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (providerId: string) => chatClient.discoverModels({ providerId }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["chat", "models"] });
		},
	});
}

export function useChatResources(projectId?: ProjectId) {
	return useQuery({
		queryKey: keys.resources(projectId),
		queryFn: () => chatClient.getResources(projectId),
	});
}

export function useChatCommands(projectId?: ProjectId) {
	return useQuery({
		queryKey: keys.commands(projectId),
		queryFn: () => chatClient.getCommands(projectId),
	});
}

export function useChatSettings(projectId?: ProjectId) {
	return useQuery({
		queryKey: keys.settings(projectId),
		queryFn: () => chatClient.getSettings(projectId),
	});
}

export function useUpdateChatSettings() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (input: { request: ChatSettingsUpdateRequest; projectId?: ProjectId }) =>
			chatClient.updateSettings(input.request, input.projectId),
		onSuccess: (settings, input) => {
			queryClient.setQueryData(keys.settings(input.projectId), settings);
			void queryClient.invalidateQueries({ queryKey: ["chat", "models"] });
			void queryClient.invalidateQueries({ queryKey: ["chat", "resources"] });
			void queryClient.invalidateQueries({ queryKey: ["chat", "commands"] });
		},
	});
}

export function useWorkspaceTree(projectId?: ProjectId, options?: { enabled?: boolean }) {
	return useQuery({
		queryKey: keys.workspace(projectId),
		queryFn: () => chatClient.getWorkspaceTree(projectId),
		enabled: options?.enabled,
	});
}

export function useChatProviders() {
	return useQuery({
		queryKey: keys.providers,
		queryFn: () => chatClient.getProviders(),
	});
}

export function useUpdateChatProvider() {
	const queryClient = useQueryClient();

	return useMutation<ChatProviderUpdateResponse, Error, ChatProviderUpdateRequest>({
		mutationFn: (request) => chatClient.updateProvider(request),
		onSuccess: (data) => {
			queryClient.setQueryData(keys.providers, { providers: data.providers });
			void queryClient.invalidateQueries({ queryKey: ["chat", "models"] });
			void queryClient.invalidateQueries({ queryKey: ["chat", "settings"] });
		},
	});
}

export function useOAuthLoginProvider() {
	const queryClient = useQueryClient();

	return useMutation<ChatProviderOAuthLoginResponse, Error, ChatProviderOAuthLoginRequest>({
		mutationFn: (request) => chatClient.oauthLoginProvider(request),
		onSuccess: (data) => {
			if (data.status !== "success" || !data.providers) return;
			queryClient.setQueryData(keys.providers, { providers: data.providers });
			void queryClient.invalidateQueries({ queryKey: ["chat", "models"] });
			void queryClient.invalidateQueries({ queryKey: ["chat", "settings"] });
		},
	});
}

export function useRemoveChatProvider() {
	const queryClient = useQueryClient();

	return useMutation<ChatProviderRemoveResponse, Error, ChatProviderRemoveRequest>({
		mutationFn: (request) => chatClient.removeProvider(request),
		onSuccess: (data) => {
			queryClient.setQueryData(keys.providers, { providers: data.providers });
			void queryClient.invalidateQueries({ queryKey: ["chat", "models"] });
			void queryClient.invalidateQueries({ queryKey: ["chat", "settings"] });
		},
	});
}
