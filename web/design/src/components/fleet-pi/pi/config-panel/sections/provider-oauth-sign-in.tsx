import { Check, ExternalLink } from "lucide-react"
import { Alert, AlertDescription } from "../../../../alert"
import { Button } from "../../../../button"
import { Input } from "../../../../input"
import { Spinner } from "../../../../spinner"
import { useOAuthLoginFlow } from "./use-oauth-login-flow"
import type {
  ChatProviderInfo,
  ChatProviderOAuthLoginRequest,
  ChatProviderOAuthLoginResponse,
} from "@prime-agent/web-protocol/chat-protocol"

export function ProviderOAuthSignIn({
  onConfigured,
  onOAuthLogin,
  provider,
}: {
  onConfigured?: () => void
  onOAuthLogin?: (
    request: ChatProviderOAuthLoginRequest
  ) => Promise<ChatProviderOAuthLoginResponse>
  provider: ChatProviderInfo
}) {
  const {
    busy,
    cancel,
    canStart,
    login,
    promptAnswer,
    setPromptAnswer,
    start,
    submitPrompt,
  } = useOAuthLoginFlow({
    onConfigured,
    onOAuthLogin,
    providerId: provider.id,
  })

  const waiting = login?.status === "waiting"
  const error = login?.status === "error" ? login.error : undefined
  const authUrl = waiting ? login?.authUrl : undefined
  const userCode = waiting ? login?.userCode : undefined
  const instructions = waiting ? login?.instructions : undefined
  const prompt = waiting ? login?.prompt : undefined
  const oauthOnly = provider.authType === "oauth"

  return (
    <div className="flex flex-col gap-3">
      {provider.isConfigured && oauthOnly && !waiting ? (
        <div className="flex items-center gap-2 text-sm">
          <Check className="size-3.5 text-muted-foreground" />
          <span>Connected</span>
        </div>
      ) : null}

      {waiting ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Sign in with {provider.name} to store OAuth credentials for this
            account.
          </p>
          {userCode ? (
            <p className="text-sm">
              Enter this code:{" "}
              <span className="font-mono text-foreground">{userCode}</span>
            </p>
          ) : null}
          {instructions && !userCode ? (
            <p className="text-xs text-pretty text-muted-foreground">
              {instructions}
            </p>
          ) : null}
          {authUrl ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                window.open(authUrl, "_blank", "noopener,noreferrer")
              }}
            >
              <ExternalLink data-icon="inline-start" />
              Open sign-in page
            </Button>
          ) : prompt ? null : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3" />
              Waiting for sign-in…
            </div>
          )}
          {prompt ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-pretty text-muted-foreground">
                {prompt.message}
              </p>
              <Input
                value={promptAnswer}
                placeholder={prompt.placeholder}
                onChange={(event) => setPromptAnswer(event.target.value)}
                aria-label={prompt.message}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || (!prompt.allowEmpty && !promptAnswer.trim())}
                  onClick={() => {
                    void submitPrompt()
                  }}
                >
                  {busy ? <Spinner data-icon="inline-start" /> : null}
                  Continue
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                void cancel()
              }}
            >
              Cancel sign-in
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {error ? (
            <Alert className="px-3 py-2">
              <AlertDescription className="text-xs text-pretty">
                {error}
              </AlertDescription>
            </Alert>
          ) : (
            <p className="text-xs text-pretty text-muted-foreground">
              {oauthOnly && provider.isConfigured
                ? `Sign in again with ${provider.name} to refresh OAuth credentials.`
                : oauthOnly
                  ? `Sign in with ${provider.name}. No API key is stored; credentials are saved to auth.json.`
                  : `Sign in with ${provider.name} to use OAuth credentials; API-key editing remains available above.`}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={busy || !canStart}
              onClick={() => {
                void start()
              }}
            >
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Sign in with {provider.name}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
