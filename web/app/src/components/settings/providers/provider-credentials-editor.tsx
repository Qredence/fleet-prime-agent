import type { ChatProviderInfo, PiCustomProviderApi } from "@prime-agent/web-protocol/chat-protocol";
import { isCustomProviderId, isOccProviderId } from "@prime-agent/web-protocol/provider-catalog";
import { ArrowLeft, Box, Globe, Info, Layers, Plus, Search, Tag, X } from "lucide-react";
import { useMemo, useState } from "react";
import { SecretCredentialField, TextCredentialField } from "@/components/settings/credential-fields";
import { ProviderBrandIcon } from "@/components/settings/providers/provider-brand-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
	CUSTOM_PROVIDER_PICKER_ID,
	isOAuthProvider,
	supportsOAuth,
} from "@/hooks/settings/use-provider-credentials-controller";
import { PROVIDER_METADATA } from "@/lib/settings/provider-metadata";
import { cn } from "@/lib/utils";

/** Progressive list page size for large custom-provider catalogs in settings. */
export const CUSTOM_PROVIDER_MODELS_PAGE_SIZE = 40;

const OPENAI_CHAT_BASE_URL_PLACEHOLDER = "https://opencode.ai/zen/v1";
const OPENAI_CHAT_MODEL_PLACEHOLDER = "qwen35-122b-a10b";
const OPENAI_CHAT_NAME_PLACEHOLDER = "e.g. OpenCode Zen, Nebius, Groq…";

const CUSTOM_PROVIDER_API_OPTIONS: Array<{
	value: PiCustomProviderApi;
	label: string;
}> = [
	{ value: "openai-completions", label: "OpenAI Chat Completions" },
	{ value: "openai-responses", label: "OpenAI Responses" },
	{ value: "anthropic-messages", label: "Anthropic Messages" },
	{ value: "google-genai", label: "Google Generative AI" },
];

export function ProviderOAuthTerminalFallback({ provider }: { provider: ChatProviderInfo }) {
	return (
		<Alert className="px-3 py-2">
			<AlertDescription className="text-xs text-pretty">
				Sign-in has to run inside Prime Agent. In a terminal, start Prime Agent against the same account as Fleet,
				then run <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">/login</code> and
				choose {provider.name}. Fleet reads the stored credential on every request, so a restart is not needed. If
				Fleet uses a non-default account directory, start Prime Agent with the same{" "}
				<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
					PRIME_AGENT_CODING_AGENT_DIR
				</code>{" "}
				it uses.
			</AlertDescription>
		</Alert>
	);
}

export function CustomProviderModelsEditor({
	attemptedSave,
	modelIds,
	newModelId,
	onChange,
	onNewModelIdChange,
}: {
	attemptedSave: boolean;
	modelIds: Array<string>;
	newModelId: string;
	onChange: (modelIds: Array<string>) => void;
	onNewModelIdChange: (value: string) => void;
}) {
	const [filter, setFilter] = useState("");
	const [visibleCount, setVisibleCount] = useState(CUSTOM_PROVIDER_MODELS_PAGE_SIZE);
	const normalizedFilter = filter.trim().toLowerCase();

	const filteredModelIds = useMemo(() => {
		if (!normalizedFilter) return modelIds;
		return modelIds.filter((id) => id.toLowerCase().includes(normalizedFilter));
	}, [modelIds, normalizedFilter]);

	const visibleModelIds = useMemo(() => filteredModelIds.slice(0, visibleCount), [filteredModelIds, visibleCount]);

	const showEmptyError = attemptedSave && modelIds.length === 0;
	const canLoadMore = visibleModelIds.length < filteredModelIds.length;

	const addModelId = () => {
		const trimmed = newModelId.trim();
		if (!trimmed) return;
		if (modelIds.includes(trimmed)) {
			onNewModelIdChange("");
			return;
		}
		onChange([...modelIds, trimmed]);
		onNewModelIdChange("");
	};

	const removeModelId = (id: string) => {
		onChange(modelIds.filter((entry) => entry !== id));
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-col gap-1">
				<span className="text-xs font-medium text-muted-foreground">Model ids</span>
				<InputGroup>
					<InputGroupAddon align="inline-start">
						<Search />
					</InputGroupAddon>
					<InputGroupInput
						aria-label="Search model ids"
						placeholder="Search models…"
						value={filter}
						onChange={(event) => {
							setFilter(event.target.value);
							setVisibleCount(CUSTOM_PROVIDER_MODELS_PAGE_SIZE);
						}}
					/>
				</InputGroup>
			</div>

			<div
				className={cn(
					"max-h-48 overflow-y-auto overscroll-contain rounded-lg border border-border/60 bg-muted/20",
					showEmptyError && "border-destructive/60",
				)}
				aria-live="polite"
			>
				{filteredModelIds.length === 0 ? (
					<p className="px-3 py-4 text-center text-xs text-pretty text-muted-foreground">
						{modelIds.length === 0
							? "Add at least one model id for this provider."
							: "No model ids match your search."}
					</p>
				) : (
					<ul className="flex flex-col divide-y divide-border/40">
						{visibleModelIds.map((id) => (
							<li key={id} className="flex items-center gap-2 px-2 py-1.5">
								<Layers aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate font-mono text-xs">{id}</span>
								<Button
									type="button"
									variant="ghost"
									size="icon-compact"
									className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
									aria-label={`Remove model ${id}`}
									onClick={() => removeModelId(id)}
								>
									<X />
								</Button>
							</li>
						))}
					</ul>
				)}
			</div>

			{canLoadMore ? (
				<Button
					type="button"
					variant="outline"
					size="compact"
					className="self-start"
					onClick={() => setVisibleCount((current) => current + CUSTOM_PROVIDER_MODELS_PAGE_SIZE)}
				>
					Load more ({filteredModelIds.length - visibleModelIds.length} remaining)
				</Button>
			) : null}

			<div className="flex items-center gap-1.5">
				<InputGroup className="flex-1">
					<InputGroupAddon align="inline-start">
						<Plus />
					</InputGroupAddon>
					<InputGroupInput
						aria-label="Add model id"
						placeholder="Add model id…"
						value={newModelId}
						onChange={(event) => onNewModelIdChange(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
								event.preventDefault();
								addModelId();
							}
						}}
					/>
				</InputGroup>
				<Button type="button" size="compact" variant="outline" disabled={!newModelId.trim()} onClick={addModelId}>
					Add
				</Button>
			</div>

			{modelIds.length > 0 ? (
				<p className="text-xs text-muted-foreground tabular-nums">
					{modelIds.length} model{modelIds.length === 1 ? "" : "s"}
					{normalizedFilter ? ` · ${filteredModelIds.length} matching search` : ""}
				</p>
			) : null}
			{showEmptyError ? <p className="text-xs text-destructive">At least one model id is required.</p> : null}
		</div>
	);
}

function ApiSelector({
	value,
	onChange,
}: {
	value: PiCustomProviderApi;
	onChange: (value: PiCustomProviderApi) => void;
}) {
	return (
		<div className="flex flex-col gap-1">
			<span className="text-xs font-medium text-muted-foreground">API family</span>
			<Select
				aria-label="API family"
				value={value}
				options={CUSTOM_PROVIDER_API_OPTIONS}
				placeholder="Select API family"
				onValueChange={(next) => onChange(next as PiCustomProviderApi)}
			/>
		</div>
	);
}

/**
 * Renders credential fields for a provider, including OpenAI Chat-specific
 * settings when enabled and general custom-provider settings (API family +
 * model list) when `isCustom` is enabled.
 */
export function ProviderCredentialFields({
	attemptedSave,
	apiKey,
	api,
	baseUrl,
	modelId,
	modelIds,
	displayName,
	isCustom,
	onApiKeyChange,
	onApiChange,
	onBaseUrlChange,
	onModelIdChange,
	onModelIdsChange,
	onDisplayNameChange,
	onTogglePassword,
	openAiChat,
	placeholder,
	showPassword,
}: {
	attemptedSave: boolean;
	apiKey: string;
	api?: PiCustomProviderApi;
	baseUrl: string;
	modelId: string;
	modelIds?: Array<string>;
	displayName?: string;
	isCustom?: boolean;
	onApiKeyChange: (value: string) => void;
	onApiChange?: (value: PiCustomProviderApi) => void;
	onBaseUrlChange: (value: string) => void;
	onModelIdChange: (value: string) => void;
	onModelIdsChange?: (value: Array<string>) => void;
	onDisplayNameChange?: (value: string) => void;
	onTogglePassword: () => void;
	openAiChat: boolean;
	placeholder: string;
	showPassword: boolean;
}) {
	const showApiSelector = isCustom && onApiChange;
	const showMultiModels = isCustom && onModelIdsChange;

	return (
		<FieldGroup className="gap-2">
			{(openAiChat || isCustom) && onDisplayNameChange ? (
				<TextCredentialField
					attemptedSave={attemptedSave}
					icon={Tag}
					label="Provider name"
					placeholder={OPENAI_CHAT_NAME_PLACEHOLDER}
					value={displayName ?? ""}
					onChange={onDisplayNameChange}
				/>
			) : null}
			{showApiSelector ? <ApiSelector value={api ?? "openai-completions"} onChange={onApiChange} /> : null}
			<SecretCredentialField
				attemptedSave={attemptedSave}
				label="API key"
				placeholder={placeholder}
				value={apiKey}
				showPassword={showPassword}
				onChange={onApiKeyChange}
				onToggleVisibility={onTogglePassword}
			/>
			{openAiChat || isCustom ? (
				<TextCredentialField
					attemptedSave={attemptedSave}
					icon={Globe}
					inputType="url"
					label="Base URL"
					placeholder={OPENAI_CHAT_BASE_URL_PLACEHOLDER}
					value={baseUrl}
					onChange={onBaseUrlChange}
				/>
			) : null}
			{showMultiModels ? (
				<CustomProviderModelsEditor
					attemptedSave={attemptedSave}
					modelIds={modelIds ?? []}
					newModelId={modelId}
					onChange={onModelIdsChange}
					onNewModelIdChange={onModelIdChange}
				/>
			) : null}
			{openAiChat && !showMultiModels ? (
				<TextCredentialField
					attemptedSave={attemptedSave}
					icon={Box}
					label="Model name"
					placeholder={OPENAI_CHAT_MODEL_PLACEHOLDER}
					value={modelId}
					onChange={onModelIdChange}
				/>
			) : null}
		</FieldGroup>
	);
}

export function AddProviderPickerPanel({
	addPickerQuery,
	credentialProvidersLength,
	filteredPickerAvailable,
	filteredPickerConfigured,
	pickerHasResults,
	onClose,
	onQueryChange,
	onSelect,
}: {
	addPickerQuery: string;
	credentialProvidersLength: number;
	filteredPickerAvailable: Array<ChatProviderInfo>;
	filteredPickerConfigured: Array<ChatProviderInfo>;
	pickerHasResults: boolean;
	onClose: () => void;
	onQueryChange: (value: string) => void;
	onSelect: (providerId: string) => void;
}) {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<Button type="button" variant="ghost" size="icon-compact" aria-label="Back to providers" onClick={onClose}>
					<ArrowLeft />
				</Button>
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium">Add provider</p>
					<p className="text-xs text-pretty text-muted-foreground">
						Choose a provider to save credentials in Prime Agent’s auth.json.
					</p>
				</div>
			</div>

			<InputGroup>
				<InputGroupAddon align="inline-start">
					<Search />
				</InputGroupAddon>
				<InputGroupInput
					type="text"
					placeholder="Search providers…"
					value={addPickerQuery}
					onChange={(event) => onQueryChange(event.target.value)}
					aria-label="Search providers to add"
				/>
			</InputGroup>

			<div className="max-h-[min(24rem,50dvh)] overflow-y-auto overscroll-contain">
				{!pickerHasResults ? (
					<p className="py-6 text-center text-xs text-pretty text-muted-foreground">
						{credentialProvidersLength === 0 ? "No providers available." : "No matching providers found."}
					</p>
				) : (
					<div className="flex flex-col gap-3">
						{filteredPickerAvailable.length > 0 ? (
							<div className="flex flex-col gap-1">
								{filteredPickerAvailable.map((provider) => (
									<ProviderPickerRow
										key={provider.id}
										provider={provider}
										configured={false}
										onSelect={() => onSelect(provider.id)}
									/>
								))}
							</div>
						) : null}

						{filteredPickerConfigured.length > 0 ? (
							<div className="flex flex-col gap-1">
								{filteredPickerAvailable.length > 0 ? (
									<p className="px-2 pt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
										Already configured
									</p>
								) : null}
								{filteredPickerConfigured.map((provider) => (
									<ProviderPickerRow
										key={provider.id}
										provider={provider}
										configured
										onSelect={() => onSelect(provider.id)}
									/>
								))}
							</div>
						) : null}
					</div>
				)}
			</div>
		</div>
	);
}

export function AddProviderOAuthPanel({ onBack, provider }: { onBack: () => void; provider: ChatProviderInfo }) {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="ghost"
					size="icon-compact"
					aria-label="Back to provider list"
					onClick={onBack}
				>
					<ArrowLeft />
				</Button>
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium">Configure {provider.name}</p>
					<p className="text-xs text-pretty text-muted-foreground">
						OAuth sign-in. Credentials are stored in auth.json for this account.
					</p>
				</div>
			</div>
			<ProviderOAuthTerminalFallback provider={provider} />
		</div>
	);
}

export function AddProviderEditorPanel({
	provider,
	api,
	apiKey,
	baseUrl,
	modelId,
	modelIds,
	displayName,
	showPassword,
	attemptedSave,
	isPending,
	canSave,
	onApiKeyChange,
	onApiChange,
	onBaseUrlChange,
	onModelIdChange,
	onModelIdsChange,
	onDisplayNameChange,
	onTogglePassword,
	onBack,
	onCancel,
	onSave,
}: {
	provider: ChatProviderInfo;
	api: PiCustomProviderApi;
	apiKey: string;
	baseUrl: string;
	modelId: string;
	modelIds: Array<string>;
	displayName?: string;
	showPassword: boolean;
	attemptedSave: boolean;
	isPending: boolean;
	canSave: boolean;
	onApiKeyChange: (value: string) => void;
	onApiChange: (value: PiCustomProviderApi) => void;
	onBaseUrlChange: (value: string) => void;
	onModelIdChange: (value: string) => void;
	onModelIdsChange: (value: Array<string>) => void;
	onDisplayNameChange?: (value: string) => void;
	onTogglePassword: () => void;
	onBack: () => void;
	onCancel: () => void;
	onSave: () => void;
}) {
	const isCustomTemplate = provider.id === CUSTOM_PROVIDER_PICKER_ID || isCustomProviderId(provider.id);
	const meta =
		PROVIDER_METADATA[provider.id] ??
		(isCustomTemplate
			? PROVIDER_METADATA["custom"]
			: {
					placeholder: "Enter credentials…",
					help: "Stored securely in your local environment overrides.",
				});
	const openAiChat = isOccProviderId(provider.id) && !isCustomTemplate;
	const oauthAvailable = supportsOAuth(provider);

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="ghost"
					size="icon-compact"
					aria-label="Back to provider list"
					onClick={onBack}
				>
					<ArrowLeft />
				</Button>
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium">Configure {provider.name}</p>
					<p className="text-xs text-pretty text-muted-foreground">
						{isCustomTemplate
							? "Name this custom provider, pick its API family, then enter its API key, https base URL, and model ids."
							: openAiChat
								? "Name this OpenAI-compatible provider, then enter its API key, base URL, and model name."
								: `Stored as ${provider.envVarName} for this account.`}
					</p>
				</div>
			</div>

			<ProviderCredentialFields
				attemptedSave={attemptedSave}
				api={api}
				apiKey={apiKey}
				baseUrl={baseUrl}
				modelId={modelId}
				modelIds={modelIds}
				displayName={displayName}
				isCustom={isCustomTemplate}
				openAiChat={openAiChat}
				placeholder={meta.placeholder}
				showPassword={showPassword}
				onApiKeyChange={onApiKeyChange}
				onApiChange={onApiChange}
				onBaseUrlChange={onBaseUrlChange}
				onModelIdChange={onModelIdChange}
				onModelIdsChange={onModelIdsChange}
				onDisplayNameChange={onDisplayNameChange}
				onTogglePassword={onTogglePassword}
			/>

			<Alert className="px-3 py-2">
				<Info />
				<AlertDescription className="text-xs text-pretty">{meta.help}</AlertDescription>
			</Alert>

			<div className="flex items-center justify-end gap-1.5">
				<Button type="button" variant="ghost" size="compact" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="button" size="compact" disabled={isPending || !canSave} onClick={onSave}>
					{isPending ? <Spinner data-icon="inline-start" /> : null}
					Save
				</Button>
			</div>

			{oauthAvailable ? <ProviderOAuthTerminalFallback provider={provider} /> : null}
		</div>
	);
}

export function RemoveProviderConfirmDialog({
	confirmRemoveProvider,
	isPending,
	onClose,
	onConfirm,
}: {
	confirmRemoveProvider: ChatProviderInfo | null;
	isPending: boolean;
	onClose: () => void;
	onConfirm: (provider: ChatProviderInfo) => void;
}) {
	return (
		<AlertDialog
			open={confirmRemoveProvider !== null}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<AlertDialogContent>
				<div className="flex flex-col gap-2">
					<AlertDialogTitle>Remove {confirmRemoveProvider?.name ?? "provider"}?</AlertDialogTitle>
					<AlertDialogDescription>
						This clears stored credentials for this provider from your workspace settings. Active sessions will
						stop using it immediately.
					</AlertDialogDescription>
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						disabled={isPending || !confirmRemoveProvider}
						onClick={() => {
							if (confirmRemoveProvider) onConfirm(confirmRemoveProvider);
						}}
					>
						{isPending ? <Spinner data-icon="inline-start" /> : null}
						Remove provider
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function ProviderPickerRow({
	configured,
	onSelect,
	provider,
}: {
	configured: boolean;
	onSelect: () => void;
	provider: ChatProviderInfo;
}) {
	const openAiChat = isOccProviderId(provider.id);
	const isCustomTemplate = provider.id === CUSTOM_PROVIDER_PICKER_ID || isCustomProviderId(provider.id);
	const oauthOnly = isOAuthProvider(provider);
	const oauthAvailable = supportsOAuth(provider);

	return (
		<Button
			type="button"
			variant="ghost"
			className="h-auto w-full justify-start gap-3 rounded-lg px-2 py-2 text-left font-normal text-foreground hover:bg-muted/60 active:scale-[0.96]"
			onClick={onSelect}
		>
			<div className="flex size-8 shrink-0 items-center justify-center rounded-[4px] border border-border/40 bg-background/60">
				<ProviderBrandIcon
					provider={isCustomTemplate ? "custom" : provider.id}
					api={provider.api}
					className="text-foreground/70"
				/>
			</div>
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-medium">{provider.name}</div>
				<div className="truncate text-xs text-muted-foreground">
					{oauthOnly
						? "OAuth sign-in"
						: oauthAvailable
							? "API key or OAuth"
							: isCustomTemplate
								? "API family + key + https base URL + models"
								: openAiChat
									? "API key + base URL + model name"
									: provider.envVarName}
					{configured ? " · Update" : ""}
				</div>
			</div>
		</Button>
	);
}
