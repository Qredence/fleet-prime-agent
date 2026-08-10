import { Cpu } from "lucide-react"
import {
  KNOWN_PROVIDERS,
  PROVIDER_METADATA,
  isCustomProviderId,
  isOccProviderId,
} from "../shared/provider-metadata"
import { cn } from "../../../../../lib/utils"
import type { PiCustomProviderApi } from "../shared/provider-metadata"

const BRAND_CLASS = "size-4"

function OpenAiMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn(BRAND_CLASS, className)}
      fill="currentColor"
      aria-hidden
    >
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.368v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.814 3.354-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.079.079 0 0 0-.041-.067zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zM8.306 12.683l-2.02-1.163a.08.08 0 0 1-.038-.057V6.074a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.392.681zm1.098-2.016l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  )
}

function AnthropicMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn(BRAND_CLASS, className)}
      fill="currentColor"
      aria-hidden
    >
      <path d="M17.305 14.256h-3.778l-2.28-7.23h-.005l-2.32 7.23H5.145L9.93 3h4.14l4.235 11.256zm-8.48 2.37h6.37l1.16 3.374h3.465L14.18 3h-4.36L4.15 20h3.465l1.21-3.374z" />
    </svg>
  )
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn(BRAND_CLASS, className)}
      fill="currentColor"
      aria-hidden
    >
      <path d="M21.6 12.23c0-.71-.06-1.4-.18-2.05H12v3.87h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.89-1.74 2.98-4.3 2.98-7.34z" />
      <path d="M12 22c2.7 0 4.96-.89 6.61-2.42l-3.24-2.5c-.9.6-2.04.96-3.37.96-2.59 0-4.78-1.75-5.56-4.1H3.1v2.58A9.99 9.99 0 0 0 12 22z" />
      <path d="M6.44 13.94A5.99 5.99 0 0 1 6.12 12c0-.67.12-1.33.32-1.94V7.48H3.1A9.99 9.99 0 0 0 2 12c0 1.61.39 3.14 1.1 4.52l3.34-2.58z" />
      <path d="M12 5.96c1.47 0 2.79.5 3.82 1.5l2.87-2.87C16.95 2.99 14.7 2 12 2A9.99 9.99 0 0 0 3.1 7.48l3.34 2.58C7.22 7.71 9.41 5.96 12 5.96z" />
    </svg>
  )
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn(BRAND_CLASS, className)}
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.9 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3z" />
    </svg>
  )
}

/**
 * Renders the brand icon associated with a provider.
 *
 * @param provider - The provider identifier used to select the icon
 * @param api - Optional native API family hint for general custom providers
 * @param className - Optional additional CSS class names
 * @returns The provider brand icon, catalog icon, or a generic CPU icon
 */
export function ProviderBrandIcon({
  provider,
  api,
  className,
}: {
  provider: string
  api?: PiCustomProviderApi
  className?: string
}) {
  const id = provider.toLowerCase()
  if (isCustomProviderId(id) || id === "custom") {
    if (api === "anthropic-messages") {
      return <AnthropicMark className={className} />
    }
    if (api === "google-genai") {
      return <GoogleMark className={className} />
    }
    return <OpenAiMark className={className} />
  }
  if (id === "openai" || id === "openai-codex" || isOccProviderId(id)) {
    return <OpenAiMark className={className} />
  }
  if (id === "anthropic") {
    return <AnthropicMark className={className} />
  }
  if (id === "google" || id === "google-vertex") {
    return <GoogleMark className={className} />
  }
  if (id === "github-copilot" || id === "github") {
    return <GitHubMark className={className} />
  }

  const Icon =
    provider in PROVIDER_METADATA ? PROVIDER_METADATA[provider].icon : Cpu
  return <Icon className={cn(BRAND_CLASS, className)} aria-hidden />
}

export function formatProviderLabel(provider: string) {
  return (
    KNOWN_PROVIDERS.find((entry) => entry.id === provider)?.name ?? provider
  )
}
