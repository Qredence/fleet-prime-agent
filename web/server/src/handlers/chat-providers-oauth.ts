import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai/oauth";
import { getOAuthProvider } from "@earendil-works/pi-ai/oauth";
import type { ChatProviderInfo, ChatProviderOAuthLoginResponse } from "@prime-agent/web-protocol/chat-protocol";
import { ChatProviderOAuthLoginRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { getPrimeConfig } from "../prime-config";
import { wrapApiHandler } from "../wrap-api-handler";
import { listChatProviders } from "./chat-providers";

const LOGIN_TTL_MS = 16 * 60 * 1000;

type OAuthPromptState = {
	message: string;
	placeholder?: string;
	allowEmpty?: boolean;
};

type OAuthLoginSession = {
	id: string;
	providerId: string;
	status: ChatProviderOAuthLoginResponse["status"];
	authUrl?: string;
	userCode?: string;
	instructions?: string;
	prompt?: OAuthPromptState;
	error?: string;
	abort: AbortController;
	pendingInput?: (value: string) => void;
	listProviders: () => Array<ChatProviderInfo>;
	ttl: ReturnType<typeof setTimeout>;
};

export type OAuthLoginDeps = {
	login: (providerId: string, callbacks: OAuthLoginCallbacks) => Promise<void>;
	reloadAuth: () => void;
	listProviders?: () => Array<ChatProviderInfo>;
};

const sessions = new Map<string, OAuthLoginSession>();

export function resetOAuthLoginsForTests(): void {
	for (const session of sessions.values()) {
		clearTimeout(session.ttl);
		session.abort.abort();
	}
	sessions.clear();
}

export function extractOAuthUserCode(instructions: string | undefined): string | undefined {
	if (!instructions) return undefined;
	const match = instructions.match(/Enter code:\s*([A-Za-z0-9-]+)/i);
	return match?.[1];
}

function snapshot(session: OAuthLoginSession): ChatProviderOAuthLoginResponse {
	return {
		status: session.status,
		loginId: session.id,
		...(session.authUrl ? { authUrl: session.authUrl } : {}),
		...(session.userCode ? { userCode: session.userCode } : {}),
		...(session.instructions ? { instructions: session.instructions } : {}),
		...(session.prompt ? { prompt: session.prompt } : {}),
		...(session.error ? { error: session.error } : {}),
		...(session.status === "success" ? { providers: session.listProviders() } : {}),
	};
}

function dropSession(loginId: string): void {
	const session = sessions.get(loginId);
	if (!session) return;
	clearTimeout(session.ttl);
	sessions.delete(loginId);
}

function applyAuthInfo(session: OAuthLoginSession, info: { url: string; instructions?: string }): void {
	session.authUrl = info.url;
	session.instructions = info.instructions;
	session.userCode = extractOAuthUserCode(info.instructions);
}

function waitForInput(session: OAuthLoginSession): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		session.pendingInput = resolve;
		const onAbort = () => {
			if (session.pendingInput === resolve) {
				session.pendingInput = undefined;
			}
			reject(new Error("Login cancelled"));
		};
		if (session.abort.signal.aborted) {
			onAbort();
			return;
		}
		session.abort.signal.addEventListener("abort", onAbort, { once: true });
	});
}

function finishIfTerminal(session: OAuthLoginSession): ChatProviderOAuthLoginResponse {
	return snapshot(session);
}

function setPrompt(session: OAuthLoginSession, prompt: OAuthPromptState): void {
	session.prompt = prompt;
}

export function startOAuthLogin(providerId: string, deps: OAuthLoginDeps): ChatProviderOAuthLoginResponse {
	const loginId = crypto.randomUUID();
	const abort = new AbortController();
	const session: OAuthLoginSession = {
		id: loginId,
		providerId,
		status: "waiting",
		abort,
		listProviders: deps.listProviders ?? listChatProviders,
		ttl: setTimeout(() => {
			abort.abort();
			dropSession(loginId);
		}, LOGIN_TTL_MS),
	};
	sessions.set(loginId, session);

	void deps
		.login(providerId, {
			onAuth: (info) => {
				applyAuthInfo(session, info);
			},
			onPrompt: async (prompt) => {
				setPrompt(session, {
					message: prompt.message,
					placeholder: prompt.placeholder,
					allowEmpty: prompt.allowEmpty,
				});
				return await waitForInput(session);
			},
			onManualCodeInput: () => {
				setPrompt(session, {
					message: "Paste the redirect URL after signing in",
					placeholder: "http://localhost:...?code=...",
				});
				return waitForInput(session);
			},
			signal: abort.signal,
		})
		.then(() => {
			session.status = "success";
			session.prompt = undefined;
			deps.reloadAuth();
		})
		.catch((error: unknown) => {
			session.status = "error";
			session.error = error instanceof Error ? error.message : String(error);
		});

	return snapshot(session);
}

export function pollOAuthLogin(loginId: string): ChatProviderOAuthLoginResponse {
	const session = sessions.get(loginId);
	if (!session) {
		return { status: "error", error: "Unknown or expired OAuth login" };
	}
	return finishIfTerminal(session);
}

export function continueOAuthLogin(loginId: string, promptAnswer: string): ChatProviderOAuthLoginResponse {
	const session = sessions.get(loginId);
	if (!session) {
		return { status: "error", error: "Unknown or expired OAuth login" };
	}
	const resolve = session.pendingInput;
	session.pendingInput = undefined;
	session.prompt = undefined;
	resolve?.(promptAnswer);
	return snapshot(session);
}

export function cancelOAuthLogin(loginId: string): ChatProviderOAuthLoginResponse {
	const session = sessions.get(loginId);
	if (!session) {
		return { status: "error", error: "Unknown or expired OAuth login" };
	}
	session.abort.abort();
	dropSession(loginId);
	return { status: "error", loginId, error: "Login cancelled" };
}

function oauthDeps(): OAuthLoginDeps {
	const config = getPrimeConfig();
	return {
		login: (providerId, callbacks) => config.authStorage.login(providerId, callbacks),
		reloadAuth: () => {
			config.reloadAuth();
		},
		listProviders: listChatProviders,
	};
}

export function handleChatProvidersOAuthPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json().catch(() => ({}));
		const body = ChatProviderOAuthLoginRequestSchema.parse(raw);

		if (body.cancel) {
			if (!body.loginId) {
				return Response.json(
					{ status: "error", error: "loginId is required to cancel" } satisfies ChatProviderOAuthLoginResponse,
					{ status: 400 },
				);
			}
			return Response.json(cancelOAuthLogin(body.loginId));
		}
		if (body.loginId && body.promptAnswer !== undefined) {
			return Response.json(continueOAuthLogin(body.loginId, body.promptAnswer));
		}
		if (body.loginId) {
			return Response.json(pollOAuthLogin(body.loginId));
		}

		if (!getOAuthProvider(body.providerId)) {
			return Response.json(
				{
					status: "error",
					error: `Unknown OAuth provider: ${body.providerId}`,
				} satisfies ChatProviderOAuthLoginResponse,
				{ status: 400 },
			);
		}

		return Response.json(startOAuthLogin(body.providerId, oauthDeps()));
	});
}
