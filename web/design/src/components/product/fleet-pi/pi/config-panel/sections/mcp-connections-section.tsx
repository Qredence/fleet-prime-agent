import { Plug, Plus, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { notify as toast } from "@prime-agent/web-design/lib/notify"
import type {
  ChatMcpDeleteRequest,
  ChatMcpListResponse,
  ChatMcpOAuthLoginRequest,
  ChatMcpOAuthLoginResponse,
  ChatMcpUpsertRequest,
  ChatProviderOAuthLoginRequest,
  ChatProviderOAuthLoginResponse,
  McpConnectionInfo,
} from "@prime-agent/web-protocol/chat-protocol"
import { Alert, AlertDescription } from "../../../../../ui/alert"
import { Button } from "../../../../../ui/button"
import { Field, FieldDescription, FieldLabel } from "../../../../../ui/field"
import { Input } from "../../../../../ui/input"
import { Select } from "../../../../../ui/select"
import { Spinner } from "../../../../../ui/spinner"
import { Switch } from "../../../../../ui/switch"
import { Textarea } from "../../../../../ui/textarea"
import { ItemRow } from "../../../primitives/item-row"
import { SettingsPane } from "../../../primitives/settings-pane"
import { ProviderOAuthSignIn } from "./provider-oauth-sign-in"

function statusLabel(connection: McpConnectionInfo): string {
  switch (connection.status) {
    case "connected":
      return "Connected"
    case "anonymous":
      return "Available without sign-in"
    case "needs_auth":
      return "Sign-in required"
    case "disabled":
      return "Disabled"
    default: {
      const unexpected: never = connection.status
      return unexpected
    }
  }
}

function connectionSubtitle(connection: McpConnectionInfo): string {
  const details =
    connection.transport === "http"
      ? connection.url
      : connection.commandPreview
  const parts = [
    connection.source === "builtin" ? "Built-in" : "User",
    connection.transport === "http" ? "HTTP" : "stdio",
    statusLabel(connection),
    details,
  ].filter((part): part is string => Boolean(part))
  return parts.join(" · ")
}

export function McpConnectionsSection({
  connections,
  isLoading,
  isPending,
  onOAuth,
  onRemove,
  onUpsert,
}: {
  connections: Array<McpConnectionInfo>
  isLoading: boolean
  isPending: boolean
  onOAuth?: (request: ChatMcpOAuthLoginRequest) => Promise<ChatMcpOAuthLoginResponse>
  onRemove?: (request: ChatMcpDeleteRequest) => Promise<ChatMcpListResponse>
  onUpsert?: (request: ChatMcpUpsertRequest) => Promise<ChatMcpListResponse>
}) {
  const [adding, setAdding] = useState(false)
  const [transport, setTransport] = useState<"http" | "stdio">("http")
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [oauth, setOauth] = useState(true)
  const [bearerTokenEnvVar, setBearerTokenEnvVar] = useState("")
  const [command, setCommand] = useState("")
  const [args, setArgs] = useState("")
  const [cwd, setCwd] = useState("")
  const [envLines, setEnvLines] = useState("")
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const resetAddForm = () => {
    setName("")
    setUrl("")
    setOauth(true)
    setBearerTokenEnvVar("")
    setCommand("")
    setArgs("")
    setCwd("")
    setEnvLines("")
    setTransport("http")
    setAdding(false)
  }

  const handleAdd = async () => {
    if (!onUpsert) return
    const trimmedName = name.trim()
    try {
      if (transport === "http") {
        await onUpsert({
          name: trimmedName,
          transport: "http",
          url: url.trim(),
          ...(oauth ? { oauth: true } : {}),
          ...(bearerTokenEnvVar.trim() ? { bearerTokenEnvVar: bearerTokenEnvVar.trim() } : {}),
          force: true,
        })
      } else {
        const parsedArgs = args
          .split(/\s+/)
          .map((part) => part.trim())
          .filter(Boolean)
        const env = envLines
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .flatMap((line) => {
            const equals = line.indexOf("=")
            if (equals <= 0) return []
            const child = line.slice(0, equals).trim()
            const source = line.slice(equals + 1).trim()
            if (!child || !source) return []
            return [{ child, source }]
          })
        await onUpsert({
          name: trimmedName,
          transport: "stdio",
          command: command.trim(),
          ...(parsedArgs.length > 0 ? { args: parsedArgs } : {}),
          ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
          ...(env.length > 0 ? { env } : {}),
          force: true,
        })
      }
      toast.success("MCP connection saved")
      resetAddForm()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save MCP connection")
    }
  }

  const handleRemove = async (connectionName: string) => {
    if (!onRemove) return
    try {
      await onRemove({ name: connectionName })
      toast.success(`Removed ${connectionName}`)
      setConfirmRemove(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove MCP connection")
    }
  }

  const handleLogout = async (connectionName: string) => {
    if (!onOAuth) return
    try {
      await onOAuth({ name: connectionName, action: "logout" })
      toast.success(`Signed out of ${connectionName}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign out")
    }
  }

  const oauthAdapter = useMemo(() => {
    if (!onOAuth) return undefined
    return (connection: McpConnectionInfo) =>
      async (request: ChatProviderOAuthLoginRequest): Promise<ChatProviderOAuthLoginResponse> => {
        const starting = !request.loginId && !request.cancel
        const result = await onOAuth({
          name: connection.name,
          action: starting && connection.status === "connected" ? "reconnect" : "login",
          loginId: request.loginId,
          promptAnswer: request.promptAnswer,
          cancel: request.cancel,
        })
        return result
      }
  }, [onOAuth])

  return (
    <SettingsPane
      title="MCP"
      description="Connect built-in and user MCP servers. Tokens stay on the server; this list only shows status and environment-variable names."
      actions={
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending || adding}
          onClick={() => setAdding(true)}
        >
          <Plus data-icon="inline-start" />
          Add server
        </Button>
      }
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-3.5" />
          Loading MCP connections…
        </div>
      ) : null}

      {adding ? (
        <div className="flex flex-col gap-3 rounded-xl border p-4">
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="MCP server name" />
          </Field>
          <Field>
            <FieldLabel>Transport</FieldLabel>
            <Select
              value={transport}
              onValueChange={(value) => setTransport(value as "http" | "stdio")}
              options={[
                { label: "HTTP", value: "http" },
                { label: "stdio", value: "stdio" },
              ]}
            />
          </Field>
          {transport === "http" ? (
            <>
              <Field>
                <FieldLabel>URL</FieldLabel>
                <Input value={url} onChange={(event) => setUrl(event.target.value)} aria-label="MCP server URL" />
              </Field>
              <Field orientation="horizontal" className="items-center justify-between">
                <div>
                  <FieldLabel>OAuth</FieldLabel>
                  <FieldDescription>Use the browser sign-in flow for this server.</FieldDescription>
                </div>
                <Switch
                  checked={oauth}
                  onCheckedChange={(checked) => setOauth(checked)}
                  aria-label="Use OAuth"
                />
              </Field>
              {!oauth ? (
                <Field>
                  <FieldLabel>Bearer token environment variable</FieldLabel>
                  <Input
                    value={bearerTokenEnvVar}
                    onChange={(event) => setBearerTokenEnvVar(event.target.value)}
                    aria-label="Bearer token environment variable"
                    placeholder="MCP_BEARER_TOKEN"
                  />
                </Field>
              ) : null}
            </>
          ) : (
            <>
              <Field>
                <FieldLabel>Command</FieldLabel>
                <Input value={command} onChange={(event) => setCommand(event.target.value)} aria-label="MCP command" />
              </Field>
              <Field>
                <FieldLabel>Arguments</FieldLabel>
                <Input value={args} onChange={(event) => setArgs(event.target.value)} aria-label="MCP command arguments" />
              </Field>
              <Field>
                <FieldLabel>Working directory</FieldLabel>
                <Input value={cwd} onChange={(event) => setCwd(event.target.value)} aria-label="MCP working directory" />
                <FieldDescription>Must stay inside the current workspace.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Environment mappings</FieldLabel>
                <Textarea
                  value={envLines}
                  onChange={(event) => setEnvLines(event.target.value)}
                  aria-label="MCP environment mappings"
                  placeholder="CHILD=SOURCE"
                />
                <FieldDescription>One CHILD=SOURCE pair per line. Only variable names are stored.</FieldDescription>
              </Field>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={resetAddForm}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={isPending || !name.trim()} onClick={() => void handleAdd()}>
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              Save
            </Button>
          </div>
        </div>
      ) : null}

      {!isLoading && connections.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">No MCP connections yet.</p>
      ) : null}

      <div className="flex flex-col gap-2">
        {connections.map((connection) => (
          <div key={`${connection.source}:${connection.name}`} className="flex flex-col gap-2">
            <ItemRow
              icon={<Plug className="size-4" />}
              title={connection.label}
              subtitle={connectionSubtitle(connection)}
              trailing={
                <div className="flex items-center gap-1.5">
                  {connection.usesOAuth && connection.status !== "needs_auth" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isPending || !onOAuth}
                      onClick={() => {
                        void handleLogout(connection.name)
                      }}
                    >
                      Sign out
                    </Button>
                  ) : null}
                  {connection.source === "user" ? (
                    confirmRemove === connection.name ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={isPending}
                        onClick={() => {
                          void handleRemove(connection.name)
                        }}
                      >
                        Confirm remove
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isPending || !onRemove}
                        aria-label={`Remove ${connection.name}`}
                        onClick={() => setConfirmRemove(connection.name)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )
                  ) : null}
                </div>
              }
            />
            {connection.error ? (
              <Alert className="px-3 py-2">
                <AlertDescription className="text-xs text-pretty">{connection.error}</AlertDescription>
              </Alert>
            ) : null}
            {connection.usesOAuth && oauthAdapter ? (
              <ProviderOAuthSignIn
                provider={{
                  id: connection.name,
                  name: connection.label,
                  isConfigured: connection.status === "connected",
                  envVarName: "",
                  authType: "oauth",
                  supportsOAuth: true,
                }}
                onOAuthLogin={oauthAdapter(connection)}
              />
            ) : null}
          </div>
        ))}
      </div>
    </SettingsPane>
  )
}
