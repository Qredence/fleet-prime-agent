import { Info, Trash2 } from "lucide-react"
import { Alert, AlertDescription } from "../../../../alert"
import { Button } from "../../../../button"
import { Spinner } from "../../../../spinner"
import { cn } from "../../../../../lib/utils"
import { ItemRow } from "../../../primitives/item-row"
import { HIT_AREA_EXPAND_DENSE_CLASS } from "../../../styles/tokens"
import { RowSurface } from "../../../primitives/surface"
import { PROVIDER_METADATA } from "../shared/provider-metadata"
import {
  isCustomProviderId,
  isOccProviderId,
} from "@prime-agent/web-protocol/provider-catalog"
import { ProviderBrandIcon } from "../shared/provider-brand-icon"
import { ProviderCredentialFields } from "../shared/provider-credential-fields"
import type {
  ChatProviderInfo,
  ChatProviderOAuthLoginRequest,
  ChatProviderOAuthLoginResponse,
} from "@prime-agent/web-protocol/chat-protocol"
import {
  isOAuthProvider,
  type ProviderCredentialActions,
  type ProviderCredentialForm,
  type ProviderOperationState,
  supportsOAuth,
} from "./provider-credentials-types"
import { ProviderOAuthSignIn } from "./provider-oauth-sign-in"

export function ActiveProviderList({
  providers,
  editingProvider,
  form,
  operation,
  actions,
  onEdit,
  onCancelEdit,
  onSave,
  onRemove,
  onOAuthLogin,
  onConfigured,
}: {
  providers: Array<ChatProviderInfo>
  editingProvider: string | null
  form: ProviderCredentialForm
  operation: ProviderOperationState
  actions: ProviderCredentialActions
  onEdit: (providerId: string) => void
  onCancelEdit: () => void
  onSave: (providerId: string) => void
  onRemove: (provider: ChatProviderInfo) => void
  onOAuthLogin?: (
    request: ChatProviderOAuthLoginRequest
  ) => Promise<ChatProviderOAuthLoginResponse>
  onConfigured?: () => void
}) {
  const {
    api,
    apiKey,
    baseUrl,
    modelId,
    models,
    displayName,
    showPassword,
    attemptedSave,
    canSave,
  } = form
  const { isPending, canRemove } = operation
  const {
    onApiKeyChange,
    onApiChange,
    onBaseUrlChange,
    onModelIdChange,
    onModelsChange,
    onDisplayNameChange,
    onTogglePassword,
  } = actions

  return (
    <div className="flex flex-col gap-1.5">
      {providers.map((provider) => {
        const isEditing = editingProvider === provider.id
        const isCustom = isCustomProviderId(provider.id)
        const meta =
          PROVIDER_METADATA[provider.id] ??
          PROVIDER_METADATA[isCustom ? "custom" : "openai-chat-completions"]
        const openAiChat = isOccProviderId(provider.id)
        const oauthOnly = isOAuthProvider(provider)
        const oauthAvailable = supportsOAuth(provider)

        return (
          <div key={provider.id} className="flex flex-col">
            <ItemRow
              interactive={false}
              icon={
                <ProviderBrandIcon
                  provider={provider.id}
                  api={provider.api}
                  className="text-foreground/80"
                />
              }
              title={provider.name}
              subtitle={
                oauthOnly
                  ? "OAuth sign-in"
                  : oauthAvailable
                    ? "API key or OAuth"
                  : isCustom
                    ? "Custom provider · API key + base URL + models"
                    : openAiChat
                      ? "OpenAI-compatible · API key + base URL + model name"
                      : provider.envVarName
              }
              trailing={
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      HIT_AREA_EXPAND_DENSE_CLASS,
                      "h-7 px-2 text-xs text-muted-foreground transition-[background-color,color,transform] duration-150 hover:text-destructive active:scale-[0.96]"
                    )}
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
                    size="sm"
                    className={cn(
                      HIT_AREA_EXPAND_DENSE_CLASS,
                      "h-7 px-2 text-xs transition-[background-color,transform] duration-150 active:scale-[0.96]"
                    )}
                    disabled={isPending}
                    onClick={() => {
                      if (isEditing) {
                        onCancelEdit()
                        return
                      }
                      onEdit(provider.id)
                    }}
                  >
                    {isEditing ? "Cancel" : "Update"}
                  </Button>
                </div>
              }
            />

            {isEditing ? (
              <RowSurface
                tone="inset"
                padding="md"
                className="flex flex-col gap-2 border-t border-border/30"
              >
                {oauthOnly ? (
                  <ProviderOAuthSignIn
                    key={provider.id}
                    provider={provider}
                    onConfigured={onConfigured}
                    onOAuthLogin={onOAuthLogin}
                  />
                ) : (
                  <>
                    <ProviderCredentialFields
                      attemptedSave={attemptedSave}
                      api={provider.api ?? api}
                      apiKey={apiKey}
                      baseUrl={baseUrl}
                      modelId={modelId}
                      models={models}
                      displayName={displayName}
                      isCustom={isCustom}
                      openAiChat={openAiChat}
                      placeholder={meta.placeholder}
                      showPassword={showPassword}
                      onApiKeyChange={onApiKeyChange}
                      onApiChange={onApiChange}
                      onBaseUrlChange={onBaseUrlChange}
                      onModelIdChange={onModelIdChange}
                      onModelsChange={onModelsChange}
                      onDisplayNameChange={
                        isCustom || provider.providerFamily !== undefined
                          ? onDisplayNameChange
                          : undefined
                      }
                      onTogglePassword={onTogglePassword}
                    />

                    <Alert className="px-3 py-2">
                      <Info />
                      <AlertDescription className="text-xs text-pretty">
                        {meta.help}
                      </AlertDescription>
                    </Alert>

                    <div className="flex items-center justify-end">
                      <Button
                        type="button"
                        size="sm"
                        disabled={isPending || !canSave}
                        onClick={() => onSave(provider.id)}
                      >
                        {isPending ? <Spinner data-icon="inline-start" /> : null}
                        Save
                      </Button>
                    </div>
                    {oauthAvailable ? (
                      <ProviderOAuthSignIn
                        key={`${provider.id}-oauth`}
                        provider={provider}
                        onConfigured={onConfigured}
                        onOAuthLogin={onOAuthLogin}
                      />
                    ) : null}
                  </>
                )}
              </RowSurface>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
