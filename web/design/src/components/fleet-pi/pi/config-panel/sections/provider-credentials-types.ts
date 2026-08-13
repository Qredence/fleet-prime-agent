import type { PiCustomProviderApi } from "@prime-agent/web-protocol/chat-protocol";

export type ProviderCredentialForm = {
	api: PiCustomProviderApi;
	apiKey: string;
	baseUrl: string;
	modelId: string;
	models: string;
	displayName: string;
	showPassword: boolean;
	attemptedSave: boolean;
	canSave: boolean;
};

export type ProviderOperationState = {
	isPending: boolean;
	canRemove: boolean;
};

export type ProviderCredentialActions = {
	onApiKeyChange: (value: string) => void;
	onApiChange: (value: PiCustomProviderApi) => void;
	onBaseUrlChange: (value: string) => void;
	onModelIdChange: (value: string) => void;
	onModelsChange: (value: string) => void;
	onDisplayNameChange: (value: string) => void;
	onTogglePassword: () => void;
};
