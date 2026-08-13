import type {
	ChatProviderRemoveRequest,
	ChatProviderRemoveResponse,
	ChatProviderUpdateRequest,
	ChatProviderUpdateResponse,
	ChatSettingsUpdateRequest,
} from "@prime-agent/web-protocol/chat-protocol";
import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { chatClient } from "./chat-client";

export const chatQueryKeys = {
	models: ["chat", "models"] as const,
	modelCatalog: ["chat", "models", "catalog"] as const,
	providers: ["chat", "providers"] as const,
	resources: ["chat", "resources"] as const,
	commands: ["chat", "commands"] as const,
	settings: ["chat", "settings"] as const,
	workspace: ["workspace", "tree"] as const,
} as const;

const keys = chatQueryKeys;

/** Invalidate cwd-scoped queries after the workspace root changes. */
export function invalidateWorkspaceScopedQueries(queryClient: QueryClient) {
	void queryClient.invalidateQueries({ queryKey: keys.workspace });
	void queryClient.invalidateQueries({ queryKey: keys.models });
	void queryClient.invalidateQueries({ queryKey: keys.modelCatalog });
	void queryClient.invalidateQueries({ queryKey: keys.settings });
	void queryClient.invalidateQueries({ queryKey: keys.resources });
	void queryClient.invalidateQueries({ queryKey: keys.commands });
}

export function useChatModels() {
	return useQuery({
		queryKey: keys.models,
		queryFn: () => chatClient.getModels(),
	});
}

export function useChatModelCatalog(options?: { enabled?: boolean }) {
	return useQuery({
		queryKey: keys.modelCatalog,
		queryFn: () => chatClient.getModels({ scope: "all" }),
		enabled: options?.enabled,
	});
}

export function useDiscoverChatModels() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (providerId: string) => chatClient.discoverModels({ providerId }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: keys.modelCatalog });
			void queryClient.invalidateQueries({ queryKey: keys.models });
		},
	});
}

export function useChatResources() {
	return useQuery({
		queryKey: keys.resources,
		queryFn: () => chatClient.getResources(),
	});
}

export function useChatCommands() {
	return useQuery({
		queryKey: keys.commands,
		queryFn: () => chatClient.getCommands(),
	});
}

export function useChatSettings() {
	return useQuery({
		queryKey: keys.settings,
		queryFn: () => chatClient.getSettings(),
	});
}

export function useUpdateChatSettings() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (request: ChatSettingsUpdateRequest) => chatClient.updateSettings(request),
		onSuccess: (settings) => {
			queryClient.setQueryData(keys.settings, settings);
			void queryClient.invalidateQueries({ queryKey: keys.models });
			void queryClient.invalidateQueries({ queryKey: keys.modelCatalog });
			void queryClient.invalidateQueries({ queryKey: keys.resources });
			void queryClient.invalidateQueries({ queryKey: keys.commands });
		},
	});
}

export function useWorkspaceTree(options?: { enabled?: boolean }) {
	return useQuery({
		queryKey: keys.workspace,
		queryFn: () => chatClient.getWorkspaceTree(),
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
			void queryClient.invalidateQueries({ queryKey: keys.models });
			void queryClient.invalidateQueries({ queryKey: keys.modelCatalog });
			void queryClient.invalidateQueries({ queryKey: keys.settings });
		},
	});
}

export function useRemoveChatProvider() {
	const queryClient = useQueryClient();

	return useMutation<ChatProviderRemoveResponse, Error, ChatProviderRemoveRequest>({
		mutationFn: (request) => chatClient.removeProvider(request),
		onSuccess: (data) => {
			queryClient.setQueryData(keys.providers, { providers: data.providers });
			void queryClient.invalidateQueries({ queryKey: keys.models });
			void queryClient.invalidateQueries({ queryKey: keys.modelCatalog });
			void queryClient.invalidateQueries({ queryKey: keys.settings });
		},
	});
}
