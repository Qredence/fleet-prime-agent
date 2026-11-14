import type {
	ChatProviderInfo,
	ChatProviderRemoveRequest,
	ChatProviderRemoveResponse,
	ChatProviderUpdateRequest,
	ChatProviderUpdateResponse,
} from "@prime-agent/web-protocol/chat-protocol";
import { isCustomProviderId, isOccProviderId } from "@prime-agent/web-protocol/provider-catalog";
import { Info, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { ProviderBrandIcon } from "@/components/settings/providers/provider-brand-icon";
import {
	AddProviderEditorPanel,
	AddProviderOAuthPanel,
	AddProviderPickerPanel,
	ProviderCredentialFields,
	ProviderOAuthTerminalFallback,
	RemoveProviderConfirmDialog,
} from "@/components/settings/providers/provider-credentials-editor";
import { SettingsPane } from "@/components/settings/settings-pane";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import {
	isOAuthProvider,
	type ProviderCredentialActions,
	type ProviderCredentialForm,
	type ProviderOperationState,
	supportsOAuth,
	useProviderCredentialsController,
} from "@/hooks/settings/use-provider-credentials-controller";
import { PROVIDER_METADATA } from "@/lib/settings/provider-metadata";

/**
 * Manages provider credential configuration, including adding, updating, searching, and removing providers.
 *
 * @param isLoading - Whether provider credentials are loading.
 * @param isPending - Whether a credential update or removal is pending.
 * @param onRemoveProvider - Handles provider credential removal.
 * @param onUpdateProvider - Handles provider credential updates.
 * @param providers - The available provider credential information.
 */
export function ProviderCredentialsSection({
	isLoading,
	isPending,
	onRemoveProvider,
	onUpdateProvider,
	providers,
}: {
	isLoading: boolean;
	isPending: boolean;
	onRemoveProvider?: (request: ChatProviderRemoveRequest) => Promise<ChatProviderRemoveResponse>;
	onUpdateProvider?: (request: ChatProviderUpdateRequest) => Promise<ChatProviderUpdateResponse>;
	providers: Array<ChatProviderInfo>;
}) {
	const {
		activeProviders,
		addPickerOpen,
		addPickerQuery,
		api,
		apiKey,
		attemptedSave,
		baseUrl,
		canSave,
		closeAddPicker,
		closeEditor,
		confirmRemoveProvider,
		credentialProviders,
		displayName,
		editingProvider,
		editingUnconfiguredProvider,
		filteredActiveProviders,
		filteredPickerAvailable,
		filteredPickerConfigured,
		handleRemove,
		handleSave,
		modelId,
		modelIds,
		openAddPicker,
		openEditor,
		pickerHasResults,
		searchQuery,
		selectProviderFromPicker,
		setAddPickerQuery,
		setApi,
		setApiKey,
		setBaseUrl,
		setConfirmRemoveProvider,
		setDisplayName,
		setModelId,
		setModelIds,
		setSearchQuery,
		setShowPassword,
		showPassword,
	} = useProviderCredentialsController({
		onRemoveProvider,
		onUpdateProvider,
		providers,
	});

	const form: ProviderCredentialForm = {
		api,
		apiKey,
		baseUrl,
		modelId,
		modelIds,
		displayName,
		showPassword,
		attemptedSave,
		canSave,
	};
	const operation: ProviderOperationState = {
		isPending,
		canRemove: Boolean(onRemoveProvider),
	};
	const actions: ProviderCredentialActions = {
		onApiKeyChange: setApiKey,
		onApiChange: setApi,
		onBaseUrlChange: setBaseUrl,
		onModelIdChange: setModelId,
		onModelIdsChange: setModelIds,
		onDisplayNameChange: setDisplayName,
		onTogglePassword: () => setShowPassword((current) => !current),
	};

	return (
		<SettingsPane
			title="Providers"
			description={
				<>
					Provider credentials are stored in Prime Agent’s{" "}
					<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">auth.json</code>. Custom
					providers and model definitions are stored in models.json. Enabled models and defaults are saved in
					settings.json, or the existing project settings file.
				</>
			}
		>
			{addPickerOpen ? (
				<AddProviderPickerPanel
					addPickerQuery={addPickerQuery}
					credentialProvidersLength={credentialProviders.length}
					filteredPickerAvailable={filteredPickerAvailable}
					filteredPickerConfigured={filteredPickerConfigured}
					pickerHasResults={pickerHasResults}
					onClose={closeAddPicker}
					onQueryChange={setAddPickerQuery}
					onSelect={selectProviderFromPicker}
				/>
			) : editingUnconfiguredProvider && isOAuthProvider(editingUnconfiguredProvider) ? (
				<AddProviderOAuthPanel
					key={editingUnconfiguredProvider.id}
					provider={editingUnconfiguredProvider}
					onBack={openAddPicker}
				/>
			) : editingUnconfiguredProvider ? (
				<AddProviderEditorPanel
					provider={editingUnconfiguredProvider}
					api={api}
					apiKey={apiKey}
					baseUrl={baseUrl}
					modelId={modelId}
					modelIds={modelIds}
					displayName={displayName}
					showPassword={showPassword}
					attemptedSave={attemptedSave}
					isPending={isPending}
					canSave={canSave}
					onApiKeyChange={setApiKey}
					onApiChange={setApi}
					onBaseUrlChange={setBaseUrl}
					onModelIdChange={setModelId}
					onModelIdsChange={setModelIds}
					onDisplayNameChange={setDisplayName}
					onTogglePassword={() => setShowPassword((current) => !current)}
					onBack={openAddPicker}
					onCancel={closeEditor}
					onSave={() => {
						if (editingProvider) void handleSave(editingProvider);
					}}
				/>
			) : (
				<div className="flex flex-col gap-3">
					<div className="flex items-center gap-2">
						<InputGroup className="flex-1">
							<InputGroupAddon align="inline-start">
								<Search />
							</InputGroupAddon>
							<InputGroupInput
								type="text"
								placeholder="Search credentials…"
								value={searchQuery}
								onChange={(event) => setSearchQuery(event.target.value)}
								aria-label="Search credentials"
								disabled={isLoading || activeProviders.length === 0}
							/>
						</InputGroup>
						<Button
							type="button"
							variant="outline"
							size="compact"
							disabled={isLoading || credentialProviders.length === 0}
							onClick={openAddPicker}
						>
							<Plus data-icon="inline-start" />
							Add provider
						</Button>
					</div>

					{isLoading ? (
						<div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
							<Spinner className="size-3" />
							<span>Loading…</span>
						</div>
					) : activeProviders.length === 0 ? (
						<div className="flex flex-col items-center gap-3 py-8">
							<p className="text-center text-xs text-pretty text-muted-foreground">No providers configured</p>
							<Button
								type="button"
								variant="outline"
								size="compact"
								disabled={credentialProviders.length === 0}
								onClick={openAddPicker}
							>
								<Plus data-icon="inline-start" />
								Add provider
							</Button>
						</div>
					) : filteredActiveProviders.length === 0 ? (
						<p className="py-6 text-center text-xs text-pretty text-muted-foreground">
							No matching providers found.
						</p>
					) : (
						<ActiveProviderList
							providers={filteredActiveProviders}
							editingProvider={editingProvider}
							form={form}
							operation={operation}
							actions={actions}
							onEdit={openEditor}
							onCancelEdit={closeEditor}
							onSave={(providerId) => void handleSave(providerId)}
							onRemove={setConfirmRemoveProvider}
						/>
					)}
				</div>
			)}

			<RemoveProviderConfirmDialog
				confirmRemoveProvider={confirmRemoveProvider}
				isPending={isPending}
				onClose={() => setConfirmRemoveProvider(null)}
				onConfirm={(provider) => {
					void handleRemove(provider);
				}}
			/>
		</SettingsPane>
	);
}

function ActiveProviderList({
	providers,
	editingProvider,
	form,
	operation,
	actions,
	onEdit,
	onCancelEdit,
	onSave,
	onRemove,
}: {
	providers: Array<ChatProviderInfo>;
	editingProvider: string | null;
	form: ProviderCredentialForm;
	operation: ProviderOperationState;
	actions: ProviderCredentialActions;
	onEdit: (providerId: string) => void;
	onCancelEdit: () => void;
	onSave: (providerId: string) => void;
	onRemove: (provider: ChatProviderInfo) => void;
}) {
	const { api, apiKey, baseUrl, modelId, modelIds, displayName, showPassword, attemptedSave, canSave } = form;
	const { isPending, canRemove } = operation;
	const {
		onApiKeyChange,
		onApiChange,
		onBaseUrlChange,
		onModelIdChange,
		onModelIdsChange,
		onDisplayNameChange,
		onTogglePassword,
	} = actions;

	return (
		<div className="flex flex-col gap-1.5">
			{providers.map((provider) => {
				const isEditing = editingProvider === provider.id;
				const isCustom = isCustomProviderId(provider.id);
				const meta =
					PROVIDER_METADATA[provider.id] ?? PROVIDER_METADATA[isCustom ? "custom" : "openai-chat-completions"];
				const openAiChat = isOccProviderId(provider.id);
				const oauthOnly = isOAuthProvider(provider);
				const oauthAvailable = supportsOAuth(provider);
				const subtitle = oauthOnly
					? "OAuth sign-in"
					: oauthAvailable
						? "API key or OAuth"
						: isCustom
							? "Custom provider · API key + base URL + models"
							: openAiChat
								? "OpenAI-compatible · API key + base URL + model name"
								: provider.envVarName;

				return (
					<div
						key={provider.id}
						className="flex flex-col overflow-hidden rounded-lg border border-border/50 bg-muted/20"
					>
						<Item size="sm" className="flex-nowrap gap-3 border-0 bg-transparent px-2.5 py-2">
							<ItemMedia className="size-8 shrink-0 rounded-md border border-border/40 bg-background/60 text-foreground/80">
								<ProviderBrandIcon provider={provider.id} api={provider.api} className="text-foreground/80" />
							</ItemMedia>
							<ItemContent className="min-w-0 gap-0.5">
								<ItemTitle className="w-full truncate text-sm font-medium text-foreground">
									{provider.name}
								</ItemTitle>
								<ItemDescription className="truncate text-xs text-muted-foreground">{subtitle}</ItemDescription>
							</ItemContent>
							<ItemActions className="shrink-0 gap-0.5">
								<Button
									type="button"
									variant="ghost"
									size="compact"
									className="hit-area-expand-dense h-7 px-2 text-xs text-muted-foreground transition-[background-color,color,transform] duration-150 hover:text-destructive active:scale-[0.96]"
									disabled={isPending || !canRemove}
									aria-label={`Remove ${provider.name}`}
									onClick={() => onRemove(provider)}
								>
									<Trash2 data-icon="inline-start" />
									Remove
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="compact"
									className="hit-area-expand-dense h-7 px-2 text-xs transition-[background-color,transform] duration-150 active:scale-[0.96]"
									disabled={isPending}
									onClick={() => {
										if (isEditing) {
											onCancelEdit();
											return;
										}
										onEdit(provider.id);
									}}
								>
									{!isEditing ? <Pencil data-icon="inline-start" /> : null}
									{isEditing ? "Cancel" : "Update"}
								</Button>
							</ItemActions>
						</Item>

						{isEditing ? (
							<div className="flex flex-col gap-2 border-t border-border/30 bg-muted/30 p-2.5">
								{oauthOnly ? (
									<ProviderOAuthTerminalFallback provider={provider} />
								) : (
									<>
										<ProviderCredentialFields
											attemptedSave={attemptedSave}
											api={provider.api ?? api}
											apiKey={apiKey}
											baseUrl={baseUrl}
											modelId={modelId}
											modelIds={modelIds}
											displayName={displayName}
											isCustom={isCustom}
											openAiChat={openAiChat}
											placeholder={meta.placeholder}
											showPassword={showPassword}
											onApiKeyChange={onApiKeyChange}
											onApiChange={onApiChange}
											onBaseUrlChange={onBaseUrlChange}
											onModelIdChange={onModelIdChange}
											onModelIdsChange={onModelIdsChange}
											onDisplayNameChange={
												isCustom || provider.providerFamily !== undefined ? onDisplayNameChange : undefined
											}
											onTogglePassword={onTogglePassword}
										/>

										<Alert className="px-3 py-2">
											<Info />
											<AlertDescription className="text-xs text-pretty">{meta.help}</AlertDescription>
										</Alert>

										<div className="flex items-center justify-end">
											<Button
												type="button"
												size="compact"
												disabled={isPending || !canSave}
												onClick={() => onSave(provider.id)}
											>
												{isPending ? <Spinner data-icon="inline-start" /> : null}
												Save
											</Button>
										</div>
										{oauthAvailable ? <ProviderOAuthTerminalFallback provider={provider} /> : null}
									</>
								)}
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
