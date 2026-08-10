import { Box, Globe, Layers, Tag } from "lucide-react"
import { FieldGroup } from "../../../../field"
import { Select } from "../../../../select"
import { SecretCredentialField, TextCredentialField } from "./credential-fields"
import type { PiCustomProviderApi } from "./provider-metadata"

const OPENAI_CHAT_BASE_URL_PLACEHOLDER = "https://opencode.ai/zen/v1"
const OPENAI_CHAT_MODEL_PLACEHOLDER = "qwen35-122b-a10b"
const OPENAI_CHAT_NAME_PLACEHOLDER = "e.g. OpenCode Zen, Nebius, Groq…"
const CUSTOM_MODELS_PLACEHOLDER = "model-a, model-b (comma-separated)"

export const CUSTOM_PROVIDER_API_OPTIONS: Array<{
  value: PiCustomProviderApi
  label: string
}> = [
  { value: "openai-completions", label: "OpenAI Chat Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-genai", label: "Google Generative AI" },
]

/**
 * Renders credential fields for a provider, including OpenAI Chat-specific
 * settings when enabled and general custom-provider settings (API family +
 * model list) when `isCustom` is enabled.
 *
 * @param attemptedSave - Whether the form has been submitted for validation
 * @param openAiChat - Whether to include OpenAI Chat provider fields
 * @param isCustom - Whether to include general custom-provider fields
 * @param displayName - The optional provider display name
 * @param onDisplayNameChange - Handles changes to the provider display name
 */
export function ProviderCredentialFields({
  attemptedSave,
  apiKey,
  api,
  baseUrl,
  modelId,
  models,
  displayName,
  isCustom,
  onApiKeyChange,
  onApiChange,
  onBaseUrlChange,
  onModelIdChange,
  onModelsChange,
  onDisplayNameChange,
  onTogglePassword,
  openAiChat,
  placeholder,
  showPassword,
}: {
  attemptedSave: boolean
  apiKey: string
  api?: PiCustomProviderApi
  baseUrl: string
  modelId: string
  models?: string
  displayName?: string
  isCustom?: boolean
  onApiKeyChange: (value: string) => void
  onApiChange?: (value: PiCustomProviderApi) => void
  onBaseUrlChange: (value: string) => void
  onModelIdChange: (value: string) => void
  onModelsChange?: (value: string) => void
  onDisplayNameChange?: (value: string) => void
  onTogglePassword: () => void
  openAiChat: boolean
  placeholder: string
  showPassword: boolean
}) {
  const showApiSelector = isCustom && onApiChange
  const showMultiModels = isCustom && onModelsChange

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
      {showApiSelector ? (
        <ApiSelector
          value={api ?? "openai-completions"}
          onChange={onApiChange}
        />
      ) : null}
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
        <TextCredentialField
          attemptedSave={attemptedSave}
          icon={Layers}
          label="Model ids"
          placeholder={CUSTOM_MODELS_PLACEHOLDER}
          value={models ?? ""}
          onChange={onModelsChange}
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
  )
}

function ApiSelector({
  value,
  onChange,
}: {
  value: PiCustomProviderApi
  onChange: (value: PiCustomProviderApi) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">
        API family
      </span>
      <Select
        aria-label="API family"
        value={value}
        options={CUSTOM_PROVIDER_API_OPTIONS}
        placeholder="Select API family"
        onValueChange={(next) => onChange(next as PiCustomProviderApi)}
      />
    </div>
  )
}

export { OPENAI_CHAT_BASE_URL_PLACEHOLDER, OPENAI_CHAT_MODEL_PLACEHOLDER }
