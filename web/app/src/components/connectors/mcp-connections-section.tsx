import type {
	ChatMcpDeleteRequest,
	ChatMcpListResponse,
	ChatMcpOAuthLoginRequest,
	ChatMcpOAuthLoginResponse,
	ChatMcpUpsertRequest,
	McpConnectionInfo,
} from "@prime-agent/web-protocol/chat-protocol";
import { Copy, Plug, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { SectionPanel as SettingsPane } from "@/components/ui/section-panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ChatMcpUpsertRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { useSettingsDraft } from "@/components/settings/use-settings-draft-state";
import { notify as toast } from "@/lib/notify";

function statusLabel(connection: McpConnectionInfo): string {
	if (connection.runtimeStatus === "pending") return "Connecting";
	if (connection.runtimeStatus === "not_connected") return "Not connected";
	if (connection.runtimeStatus === "setup_required") return "Setup required";
	if (connection.runtimeStatus === "error") return "Connection failed";
	switch (connection.status) {
		case "connected":
			return "Connected";
		case "anonymous":
			return "Available without sign-in";
		case "needs_auth":
			return "Sign-in required";
		case "disabled":
			return "Disabled";
		default: {
			const unexpected: never = connection.status;
			return unexpected;
		}
	}
}

function connectionSubtitle(connection: McpConnectionInfo): string {
	const details = connection.transport === "http" ? connection.url : connection.commandPreview;
	const parts = [
		connection.source === "builtin" ? "Built-in" : "User",
		connection.transport === "http" ? "HTTP" : "stdio",
		statusLabel(connection),
		details,
	].filter((part): part is string => Boolean(part));
	return parts.join(" · ");
}

export function McpConnectionsSection({
	connections,
	description = "Connect built-in and user MCP servers. Tokens stay on the server; this list only shows status and environment-variable names.",
	isLoading,
	isPending,
	onOAuth,
	onRemove,
	onUpsert,
	title = "MCP",
}: {
	connections: Array<McpConnectionInfo>;
	description?: string;
	isLoading: boolean;
	isPending: boolean;
	onOAuth?: (request: ChatMcpOAuthLoginRequest) => Promise<ChatMcpOAuthLoginResponse>;
	onRemove?: (request: ChatMcpDeleteRequest) => Promise<ChatMcpListResponse>;
	onUpsert?: (request: ChatMcpUpsertRequest) => Promise<ChatMcpListResponse>;
	title?: string;
}) {
	const [search, setSearch] = useState("");
	const [adding, setAdding] = useState(false);
	const [transport, setTransport] = useState<"http" | "stdio">("http");
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [oauth, setOauth] = useState(true);
	const [bearerTokenEnvVar, setBearerTokenEnvVar] = useState("");
	const [command, setCommand] = useState("");
	const [args, setArgs] = useState<string[]>([]);
	const [cwd, setCwd] = useState("");
	const [envBindings, setEnvBindings] = useState<Array<{ child: string; source: string }>>([]);
	const [formError, setFormError] = useState<string | null>(null);
	const [replaceConfirmed, setReplaceConfirmed] = useState(false);
	const [localPending, setLocalPending] = useState(false);
	const duplicate = connections.find((connection) => connection.name === name.trim());
	useSettingsDraft("mcp", {
		dirty: Boolean(
			name ||
			url ||
			command ||
			cwd ||
			bearerTokenEnvVar ||
			args.length ||
			envBindings.length ||
			!oauth ||
			transport !== "http",
		),
		busy: localPending || isPending,
	});
	const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

	const resetAddForm = () => {
		setName("");
		setUrl("");
		setOauth(true);
		setBearerTokenEnvVar("");
		setCommand("");
		setArgs([]);
		setCwd("");
		setEnvBindings([]);
		setFormError(null);
		setReplaceConfirmed(false);
		setTransport("http");
		setAdding(false);
	};

	const handleAdd = async () => {
		if (!onUpsert || localPending || isPending) return;
		setFormError(null);
		try {
			if (duplicate?.source === "builtin")
				throw new Error("This name belongs to a built-in server. Choose a different name.");
			if (duplicate && !replaceConfirmed) throw new Error("Confirm replacement before saving this existing server.");
			const parsed = ChatMcpUpsertRequestSchema.safeParse(
				transport === "http"
					? {
							name: name.trim(),
							transport,
							url: url.trim(),
							oauth,
							...(!oauth && bearerTokenEnvVar.trim() ? { bearerTokenEnvVar: bearerTokenEnvVar.trim() } : {}),
							force: Boolean(duplicate && replaceConfirmed),
						}
					: {
							name: name.trim(),
							transport,
							command: command.trim(),
							...(args.length ? { args } : {}),
							...(cwd.trim() ? { cwd: cwd.trim() } : {}),
							...(envBindings.length
								? {
										env: envBindings.map(({ child, source }) => ({
											child: child.trim(),
											source: source.trim(),
										})),
									}
								: {}),
							force: Boolean(duplicate && replaceConfirmed),
						},
			);
			if (!parsed.success)
				throw new Error(
					parsed.error.issues.map((issue) => `${issue.path.join(" → ")}: ${issue.message}`).join(". "),
				);
			const request = parsed.data;
			if (request.transport === "http") {
				let endpoint: URL;
				try {
					endpoint = new URL(request.url);
				} catch {
					throw new Error("Enter a complete HTTP or HTTPS URL.");
				}
				if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password)
					throw new Error("Use an HTTP or HTTPS URL without embedded credentials.");
			}
			if (
				transport === "stdio" &&
				new Set(envBindings.map((binding) => binding.child.trim())).size !== envBindings.length
			)
				throw new Error("Each child environment variable must appear only once.");
			setLocalPending(true);
			await onUpsert(request);
			toast.success("MCP connection saved");
			resetAddForm();
		} catch (error) {
			setFormError(error instanceof Error ? error.message : "Could not save MCP connection");
		} finally {
			setLocalPending(false);
		}
	};

	const handleRemove = async (connectionName: string) => {
		if (!onRemove || localPending || isPending) return;
		setLocalPending(true);
		try {
			await onRemove({ name: connectionName });
			toast.success(`Removed ${connectionName}`);
			setConfirmRemove(null);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not remove MCP connection");
		} finally {
			setLocalPending(false);
		}
	};

	const handleLogout = async (connectionName: string) => {
		if (!onOAuth || localPending || isPending) return;
		setLocalPending(true);
		try {
			await onOAuth({ name: connectionName, action: "logout" });
			toast.success(`Signed out of ${connectionName}`);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not sign out");
		} finally {
			setLocalPending(false);
		}
	};

	return (
		<SettingsPane
			title={title}
			description={description}
			actions={
				<Button
					type="button"
					size="compact"
					variant="outline"
					disabled={isPending || localPending || adding || !onUpsert}
					onClick={() => setAdding(true)}
				>
					<Plus data-icon="inline-start" />
					Add server
				</Button>
			}
		>
			<p className="text-xs text-muted-foreground">Servers are configured for your user account, across projects.</p>
			<Input
				aria-label="Search MCP servers"
				placeholder="Search MCP servers"
				value={search}
				onChange={(event) => setSearch(event.target.value)}
			/>
			{isLoading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Spinner className="size-3.5" />
					Loading MCP connections…
				</div>
			) : null}

			{adding ? (
				<div className="flex flex-col gap-3 rounded-md border p-4">
					<FieldGroup className="gap-3">
						<Field>
							<FieldLabel>Name</FieldLabel>
							<Input
								value={name}
								onChange={(event) => {
									setName(event.target.value);
									setReplaceConfirmed(false);
								}}
								aria-label="MCP server name"
							/>
						</Field>
						<Field>
							<FieldLabel>Transport</FieldLabel>
							<Select
								aria-label="Transport"
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
									<Input
										value={url}
										onChange={(event) => setUrl(event.target.value)}
										aria-label="MCP server URL"
									/>
								</Field>
								<Field orientation="horizontal" className="items-center justify-between">
									<div>
										<FieldLabel>OAuth</FieldLabel>
										<FieldDescription>
											Sign in from Prime Agent's terminal after saving this server.
										</FieldDescription>
									</div>
									<Switch
										checked={oauth}
										onCheckedChange={(checked) => {
											setOauth(checked);
											// A hidden token must not survive the toggle: OAuth and a
											// static bearer token are mutually exclusive upstream.
											if (checked) setBearerTokenEnvVar("");
										}}
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
									<Input
										value={command}
										onChange={(event) => setCommand(event.target.value)}
										aria-label="MCP command"
									/>
								</Field>
								<Field>
									<FieldLabel>Arguments</FieldLabel>
									<FieldDescription>
										Each row is one exact argument. Spaces stay inside that argument; shell quotes are
										unnecessary.
									</FieldDescription>
									{args.map((argument, index) => (
										<div key={index} className="flex gap-2">
											<Input
												aria-label={`MCP argument ${index + 1}`}
												value={argument}
												onChange={(event) =>
													setArgs((current) =>
														current.map((value, row) => (row === index ? event.target.value : value)),
													)
												}
											/>
											<Button
												variant="ghost"
												size="icon-compact"
												aria-label={`Remove argument ${index + 1}`}
												onClick={() => setArgs((current) => current.filter((_, row) => row !== index))}
											>
												<Trash2 />
											</Button>
										</div>
									))}
									<Button
										variant="outline"
										size="compact"
										disabled={args.length >= 32}
										onClick={() => setArgs((current) => [...current, ""])}
									>
										Add argument
									</Button>
								</Field>
								<Field>
									<FieldLabel>Working directory</FieldLabel>
									<Input
										value={cwd}
										onChange={(event) => setCwd(event.target.value)}
										aria-label="MCP working directory"
									/>
									<FieldDescription>Must stay inside the current workspace.</FieldDescription>
								</Field>
								<Field>
									<FieldLabel>Environment mappings</FieldLabel>
									<FieldDescription>
										Map a child variable to a server environment variable name. Never paste secret values.
									</FieldDescription>
									{envBindings.map((binding, index) => (
										<div key={index} className="flex gap-2">
											<Input
												aria-label={`Child variable ${index + 1}`}
												placeholder="CHILD_NAME"
												value={binding.child}
												onChange={(event) =>
													setEnvBindings((current) =>
														current.map((value, row) =>
															row === index ? { ...value, child: event.target.value } : value,
														),
													)
												}
											/>
											<Input
												aria-label={`Source variable ${index + 1}`}
												placeholder="SERVER_VARIABLE"
												value={binding.source}
												onChange={(event) =>
													setEnvBindings((current) =>
														current.map((value, row) =>
															row === index ? { ...value, source: event.target.value } : value,
														),
													)
												}
											/>
											<Button
												variant="ghost"
												size="icon-compact"
												aria-label={`Remove environment mapping ${index + 1}`}
												onClick={() =>
													setEnvBindings((current) => current.filter((_, row) => row !== index))
												}
											>
												<Trash2 />
											</Button>
										</div>
									))}
									<Button
										variant="outline"
										size="compact"
										disabled={envBindings.length >= 32}
										onClick={() => setEnvBindings((current) => [...current, { child: "", source: "" }])}
									>
										Add environment mapping
									</Button>
								</Field>
							</>
						)}
					</FieldGroup>
					{duplicate ? (
						<Alert>
							<AlertDescription>
								{duplicate.source === "builtin"
									? "This name is reserved for a built-in server."
									: "Replacing this server removes its stored credentials. You may need to sign in again."}
								{duplicate.source === "user" ? (
									<Button
										variant={replaceConfirmed ? "outline" : "destructive"}
										size="compact"
										onClick={() => setReplaceConfirmed((current) => !current)}
									>
										{replaceConfirmed ? "Cancel replacement" : "Confirm replacement"}
									</Button>
								) : null}
							</AlertDescription>
						</Alert>
					) : null}
					{formError ? (
						<p role="alert" className="text-sm text-destructive">
							{formError}
						</p>
					) : null}
					<div className="flex justify-end gap-2">
						<Button type="button" size="compact" variant="ghost" onClick={resetAddForm}>
							Cancel
						</Button>
						<Button
							type="button"
							size="compact"
							disabled={
								isPending ||
								localPending ||
								!onUpsert ||
								!name.trim() ||
								(transport === "http" ? !url.trim() : !command.trim()) ||
								Boolean(duplicate && (!replaceConfirmed || duplicate.source === "builtin"))
							}
							onClick={() => void handleAdd()}
						>
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
				{connections
					.filter((connection) =>
						`${connection.label} ${connection.name} ${connectionSubtitle(connection)}`
							.toLowerCase()
							.includes(search.toLowerCase()),
					)
					.map((connection) => (
						<Collapsible key={`${connection.source}:${connection.name}`} className="flex flex-col gap-2">
							<Item variant="outline" size="sm" className="flex-nowrap gap-3">
								<ItemMedia className="size-8 rounded-md border border-border/40 bg-background/60 text-foreground/70">
									<Plug className="size-4" />
								</ItemMedia>
								<ItemContent className="gap-0.5">
									<ItemTitle className="text-sm font-medium">{connection.label}</ItemTitle>

									{connection.toolCount != null ? (
										<ItemDescription>{connection.toolCount} tools reported by Prime Agent</ItemDescription>
									) : null}
									<ItemDescription className="break-all text-xs">
										{connectionSubtitle(connection)}
									</ItemDescription>
								</ItemContent>
								<ItemActions className="shrink-0 gap-1.5">
									<CollapsibleTrigger
										render={
											<Button
												variant="ghost"
												size="compact"
												aria-label={`Details for ${connection.label}`}
											/>
										}
									>
										Details
									</CollapsibleTrigger>
									{confirmRemove === connection.name ? (
										<Button variant="ghost" size="compact" onClick={() => setConfirmRemove(null)}>
											Cancel
										</Button>
									) : null}
									{connection.usesOAuth && connection.status !== "needs_auth" ? (
										<Button
											type="button"
											size="compact"
											variant="ghost"
											disabled={isPending || !onOAuth}
											onClick={() => {
												void handleLogout(connection.name);
											}}
										>
											Sign out
										</Button>
									) : null}
									{connection.source === "user" ? (
										confirmRemove === connection.name ? (
											<Button
												type="button"
												size="compact"
												variant="destructive"
												disabled={isPending}
												onClick={() => {
													void handleRemove(connection.name);
												}}
											>
												Confirm remove
											</Button>
										) : (
											<Button
												type="button"
												size="compact"
												variant="ghost"
												disabled={isPending || !onRemove}
												aria-label={`Remove ${connection.name}`}
												onClick={() => setConfirmRemove(connection.name)}
											>
												<Trash2 className="size-3.5" />
											</Button>
										)
									) : null}
								</ItemActions>
							</Item>
							<CollapsibleContent className="flex flex-col gap-2 px-3 pb-3">
								{connection.description ? (
									<p className="text-sm text-muted-foreground">{connection.description}</p>
								) : null}
								{connection.setupHint ? (
									<p className="text-xs text-muted-foreground">{connection.setupHint}</p>
								) : null}
								{connection.cwdPreview || connection.bearerTokenEnvVar || connection.envBindings?.length ? (
									<div className="rounded-md border p-3 text-xs text-muted-foreground">
										{connection.cwdPreview ? <p>Working directory: {connection.cwdPreview}</p> : null}
										{connection.bearerTokenEnvVar ? (
											<p>Bearer variable: {connection.bearerTokenEnvVar}</p>
										) : null}
										{connection.envBindings?.map((binding) => (
											<p key={binding.child}>
												{binding.child} ← {binding.source}
											</p>
										))}
									</div>
								) : null}
								{connection.error ? (
									<Alert className="px-3 py-2">
										<AlertDescription className="text-xs text-pretty">{connection.error}</AlertDescription>
									</Alert>
								) : null}
								{connection.usesOAuth && connection.status === "needs_auth" ? (
									<Alert className="px-3 py-2">
										<AlertDescription className="text-xs text-pretty">
											Sign-in has to run inside Prime Agent. In a terminal, start Prime Agent against the
											same account as Fleet, then run{" "}
											<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
												/mcp login {connection.name}
											</code>
											. Fleet picks the credential up on its next refresh, so a restart is not needed. If
											Fleet uses a non-default account directory, start Prime Agent with the same{" "}
											<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
												PRIME_AGENT_CODING_AGENT_DIR
											</code>{" "}
											it uses.
											<Button
												variant="outline"
												size="compact"
												onClick={() => {
													void navigator.clipboard.writeText(`/mcp login ${connection.name}`).then(
														() => toast.success("Sign-in command copied"),
														() => toast.error("Could not copy the command"),
													);
												}}
											>
												<Copy data-icon="inline-start" />
												Copy sign-in command
											</Button>
										</AlertDescription>
									</Alert>
								) : null}
							</CollapsibleContent>
						</Collapsible>
					))}
			</div>
		</SettingsPane>
	);
}
