import { Plus, Search } from "lucide-react"
import { Button } from "../../../../button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../../../../input-group"
import { Spinner } from "../../../../spinner"
import { SettingsPane } from "../../../primitives/settings-pane"
import {
  AddProviderEditorPanel,
  AddProviderPickerPanel,
  RemoveProviderConfirmDialog,
} from "./provider-credentials-editor"
import { ActiveProviderList } from "./provider-credentials-list"
import type {
  ProviderCredentialActions,
  ProviderCredentialForm,
  ProviderOperationState,
} from "./provider-credentials-types"
import { useProviderCredentialsController } from "./use-provider-credentials-controller"
import type {
  ChatProviderInfo,
  ChatProviderRemoveRequest,
  ChatProviderRemoveResponse,
  ChatProviderUpdateRequest,
  ChatProviderUpdateResponse,
} from "@prime-agent/web-protocol/chat-protocol"

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
  isLoading: boolean
  isPending: boolean
  onRemoveProvider?: (
    request: ChatProviderRemoveRequest
  ) => Promise<ChatProviderRemoveResponse>
  onUpdateProvider?: (
    request: ChatProviderUpdateRequest
  ) => Promise<ChatProviderUpdateResponse>
  providers: Array<ChatProviderInfo>
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
    models,
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
    setModels,
    setSearchQuery,
    setShowPassword,
    showPassword,
  } = useProviderCredentialsController({
    onRemoveProvider,
    onUpdateProvider,
    providers,
  })

  const form: ProviderCredentialForm = {
    api,
    apiKey,
    baseUrl,
    modelId,
    models,
    displayName,
    showPassword,
    attemptedSave,
    canSave,
  }
  const operation: ProviderOperationState = {
    isPending,
    canRemove: Boolean(onRemoveProvider),
  }
  const actions: ProviderCredentialActions = {
    onApiKeyChange: setApiKey,
    onApiChange: setApi,
    onBaseUrlChange: setBaseUrl,
    onModelIdChange: setModelId,
    onModelsChange: setModels,
    onDisplayNameChange: setDisplayName,
    onTogglePassword: () => setShowPassword((current) => !current),
  }

  return (
    <SettingsPane
      title="Providers"
      description="Locally, API keys are stored in `.env.local`. When deployed, they are stored encrypted in your account."
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
      ) : editingUnconfiguredProvider ? (
        <AddProviderEditorPanel
          provider={editingUnconfiguredProvider}
          api={api}
          apiKey={apiKey}
          baseUrl={baseUrl}
          modelId={modelId}
          models={models}
          displayName={displayName}
          showPassword={showPassword}
          attemptedSave={attemptedSave}
          isPending={isPending}
          canSave={canSave}
          onApiKeyChange={setApiKey}
          onApiChange={setApi}
          onBaseUrlChange={setBaseUrl}
          onModelIdChange={setModelId}
          onModelsChange={setModels}
          onDisplayNameChange={setDisplayName}
          onTogglePassword={() => setShowPassword((current) => !current)}
          onBack={openAddPicker}
          onCancel={closeEditor}
          onSave={() => {
            if (editingProvider) void handleSave(editingProvider)
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
              size="sm"
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
              <span>Loading...</span>
            </div>
          ) : activeProviders.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-center text-xs text-pretty text-muted-foreground">
                No providers configured
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
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
          void handleRemove(provider)
        }}
      />
    </SettingsPane>
  )
}
