import { ArrowLeft, Info, Search } from "lucide-react"
import { Alert, AlertDescription } from "../../../../../ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "../../../../../ui/alert-dialog"
import { Button } from "../../../../../ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../../../../../ui/input-group"
import { Spinner } from "../../../../../ui/spinner"
import { cn } from "../../../../../../lib/utils"
import { PROVIDER_METADATA } from "../shared/provider-metadata"
import {
  isCustomProviderId,
  isOccProviderId,
} from "@prime-agent/web-protocol/provider-catalog"
import { ProviderBrandIcon } from "../shared/provider-brand-icon"
import { ProviderCredentialFields } from "../shared/provider-credential-fields"
import { CUSTOM_PROVIDER_PICKER_ID } from "./use-provider-credentials-controller"
import { isOAuthProvider, supportsOAuth } from "./provider-credentials-types"
import { ProviderOAuthSignIn } from "./provider-oauth-sign-in"
import type {
  ChatProviderInfo,
  ChatProviderOAuthLoginRequest,
  ChatProviderOAuthLoginResponse,
  PiCustomProviderApi,
} from "@prime-agent/web-protocol/chat-protocol"

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
  addPickerQuery: string
  credentialProvidersLength: number
  filteredPickerAvailable: Array<ChatProviderInfo>
  filteredPickerConfigured: Array<ChatProviderInfo>
  pickerHasResults: boolean
  onClose: () => void
  onQueryChange: (value: string) => void
  onSelect: (providerId: string) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Back to providers"
          onClick={onClose}
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Add provider</p>
          <p className="text-xs text-pretty text-muted-foreground">
            Choose a provider to store encrypted credentials for this account.
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

      <div className="max-h-[min(24rem,50vh)] overflow-y-auto">
        {!pickerHasResults ? (
          <p className="py-6 text-center text-xs text-pretty text-muted-foreground">
            {credentialProvidersLength === 0
              ? "No providers available."
              : "No matching providers found."}
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
                  <p className="px-2 pt-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
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
  )
}

export function AddProviderOAuthPanel({
  onBack,
  onConfigured,
  onOAuthLogin,
  provider,
}: {
  onBack: () => void
  onConfigured?: () => void
  onOAuthLogin?: (
    request: ChatProviderOAuthLoginRequest
  ) => Promise<ChatProviderOAuthLoginResponse>
  provider: ChatProviderInfo
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
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
      <ProviderOAuthSignIn
        key={provider.id}
        provider={provider}
        onConfigured={onConfigured}
        onOAuthLogin={onOAuthLogin}
      />
    </div>
  )
}

export function AddProviderEditorPanel({
  provider,
  api,
  apiKey,
  baseUrl,
  modelId,
  models,
  displayName,
  showPassword,
  attemptedSave,
  isPending,
  canSave,
  onApiKeyChange,
  onApiChange,
  onBaseUrlChange,
  onModelIdChange,
  onModelsChange,
  onDisplayNameChange,
  onTogglePassword,
  onBack,
  onCancel,
  onConfigured,
  onOAuthLogin,
  onSave,
}: {
  provider: ChatProviderInfo
  api: PiCustomProviderApi
  apiKey: string
  baseUrl: string
  modelId: string
  models: string
  displayName?: string
  showPassword: boolean
  attemptedSave: boolean
  isPending: boolean
  canSave: boolean
  onApiKeyChange: (value: string) => void
  onApiChange: (value: PiCustomProviderApi) => void
  onBaseUrlChange: (value: string) => void
  onModelIdChange: (value: string) => void
  onModelsChange: (value: string) => void
  onDisplayNameChange?: (value: string) => void
  onTogglePassword: () => void
  onBack: () => void
  onCancel: () => void
  onConfigured?: () => void
  onOAuthLogin?: (
    request: ChatProviderOAuthLoginRequest
  ) => Promise<ChatProviderOAuthLoginResponse>
  onSave: () => void
}) {
  const isCustomTemplate =
    provider.id === CUSTOM_PROVIDER_PICKER_ID || isCustomProviderId(provider.id)
  const meta =
    PROVIDER_METADATA[provider.id] ??
    (isCustomTemplate
      ? PROVIDER_METADATA["custom"]
      : {
          placeholder: "Enter credentials…",
          help: "Stored securely in your local environment overrides.",
        })
  const openAiChat = isOccProviderId(provider.id) && !isCustomTemplate
  const oauthAvailable = supportsOAuth(provider)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
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
        models={models}
        displayName={displayName}
        isCustom={isCustomTemplate}
        openAiChat={openAiChat}
        placeholder={meta.placeholder}
        showPassword={showPassword}
        onApiKeyChange={onApiKeyChange}
        onApiChange={onApiChange}
        onBaseUrlChange={onBaseUrlChange}
        onModelIdChange={onModelIdChange}
        onModelsChange={onModelsChange}
        onDisplayNameChange={onDisplayNameChange}
        onTogglePassword={onTogglePassword}
      />

      <Alert className="px-3 py-2">
        <Info />
        <AlertDescription className="text-xs text-pretty">
          {meta.help}
        </AlertDescription>
      </Alert>

      <div className="flex items-center justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={isPending || !canSave}
          onClick={onSave}
        >
          {isPending ? <Spinner data-icon="inline-start" /> : null}
          Save
        </Button>
      </div>
      {oauthAvailable ? (
        <ProviderOAuthSignIn
          key={`${provider.id}-oauth`}
          provider={provider}
          onConfigured={onConfigured ?? onCancel}
          onOAuthLogin={onOAuthLogin}
        />
      ) : null}
    </div>
  )
}

export function RemoveProviderConfirmDialog({
  confirmRemoveProvider,
  isPending,
  onClose,
  onConfirm,
}: {
  confirmRemoveProvider: ChatProviderInfo | null
  isPending: boolean
  onClose: () => void
  onConfirm: (provider: ChatProviderInfo) => void
}) {
  return (
    <AlertDialog
      open={confirmRemoveProvider !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent>
        <div className="flex flex-col gap-2">
          <AlertDialogTitle>
            Remove {confirmRemoveProvider?.name ?? "provider"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This clears stored credentials for this provider from your workspace
            settings. Active sessions will stop using it immediately.
          </AlertDialogDescription>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending || !confirmRemoveProvider}
            onClick={() => {
              if (confirmRemoveProvider) onConfirm(confirmRemoveProvider)
            }}
          >
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Remove provider
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ProviderPickerRow({
  configured,
  onSelect,
  provider,
}: {
  configured: boolean
  onSelect: () => void
  provider: ChatProviderInfo
}) {
  const openAiChat = isOccProviderId(provider.id)
  const isCustomTemplate =
    provider.id === CUSTOM_PROVIDER_PICKER_ID || isCustomProviderId(provider.id)
  const oauthOnly = isOAuthProvider(provider)
  const oauthAvailable = supportsOAuth(provider)

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-[background-color,transform] duration-150",
        "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.96]"
      )}
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
    </button>
  )
}
