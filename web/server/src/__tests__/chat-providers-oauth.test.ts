import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai/oauth";
import type { ChatProviderOAuthLoginResponse } from "@prime-agent/web-protocol/chat-protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
	cancelOAuthLogin,
	continueOAuthLogin,
	extractOAuthUserCode,
	handleChatProvidersOAuthPost,
	type OAuthLoginDeps,
	pollOAuthLogin,
	resetOAuthLoginsForTests,
	startOAuthLogin,
} from "../handlers/chat-providers-oauth";

afterEach(() => {
	resetOAuthLoginsForTests();
});

function hangingLogin(run: (callbacks: OAuthLoginCallbacks) => void | Promise<void>): OAuthLoginDeps["login"] {
	return async (_providerId, callbacks) => {
		await run(callbacks);
		await new Promise<void>((_resolve, reject) => {
			callbacks.signal?.addEventListener(
				"abort",
				() => {
					reject(new Error("Login cancelled"));
				},
				{ once: true },
			);
		});
	};
}

function completingLogin(run: (callbacks: OAuthLoginCallbacks) => void | Promise<void>): OAuthLoginDeps["login"] {
	return async (_providerId, callbacks) => {
		await run(callbacks);
	};
}

async function waitForLogin(
	loginId: string,
	pred: (result: ChatProviderOAuthLoginResponse) => boolean,
): Promise<ChatProviderOAuthLoginResponse> {
	for (let i = 0; i < 80; i++) {
		const snap = pollOAuthLogin(loginId);
		if (pred(snap)) return snap;
		await new Promise((resolve) => {
			setTimeout(resolve, 5);
		});
	}
	throw new Error(`timed out waiting for OAuth login ${loginId}`);
}

describe("extractOAuthUserCode", () => {
	it("parses the device-code instructions Copilot emits", () => {
		expect(extractOAuthUserCode("Enter code: ABCD-EFGH")).toBe("ABCD-EFGH");
		expect(extractOAuthUserCode("Open the URL")).toBeUndefined();
	});
});

describe("startOAuthLogin", () => {
	it("returns a loginId immediately before onAuth", () => {
		const result = startOAuthLogin("github-copilot", {
			login: hangingLogin(() => {}),
			reloadAuth: () => {},
			listProviders: () => [],
		});

		expect(result.status).toBe("waiting");
		expect(result.loginId).toBeTruthy();
		expect(result.authUrl).toBeUndefined();
	});

	it("surfaces authUrl and userCode on poll after onAuth", async () => {
		const result = startOAuthLogin("github-copilot", {
			login: hangingLogin((callbacks) => {
				callbacks.onAuth({
					url: "https://github.com/login/device",
					instructions: "Enter code: ABCD-EFGH",
				});
			}),
			reloadAuth: () => {},
			listProviders: () => [],
		});

		const polled = await waitForLogin(result.loginId ?? "", (snap) => snap.userCode === "ABCD-EFGH");
		expect(polled.status).toBe("waiting");
		expect(polled.authUrl).toBe("https://github.com/login/device");
		expect(polled.userCode).toBe("ABCD-EFGH");
	});

	it("surfaces allowEmpty prompts instead of auto-answering them", async () => {
		const result = startOAuthLogin("github-copilot", {
			login: hangingLogin(async (callbacks) => {
				await callbacks.onPrompt({
					message: "GitHub Enterprise URL/domain (blank for github.com)",
					placeholder: "company.ghe.com",
					allowEmpty: true,
				});
				callbacks.onAuth({
					url: "https://github.com/login/device",
					instructions: "Enter code: ZZ-99",
				});
			}),
			reloadAuth: () => {},
			listProviders: () => [],
		});

		const prompted = await waitForLogin(result.loginId ?? "", (snap) => snap.prompt?.allowEmpty === true);
		expect(prompted.status).toBe("waiting");
		expect(prompted.prompt?.message).toContain("GitHub Enterprise");
		expect(prompted.userCode).toBeUndefined();

		continueOAuthLogin(result.loginId ?? "", "");
		const polled = await waitForLogin(result.loginId ?? "", (snap) => snap.userCode === "ZZ-99");
		expect(polled.status).toBe("waiting");
		expect(polled.prompt).toBeUndefined();
	});

	it("surfaces a non-empty prompt and continues when the client answers", async () => {
		const result = startOAuthLogin("anthropic", {
			login: hangingLogin(async (callbacks) => {
				await callbacks.onPrompt({
					message: "Paste the authorization code",
					placeholder: "code",
				});
			}),
			reloadAuth: () => {},
			listProviders: () => [],
		});

		const prompted = await waitForLogin(
			result.loginId ?? "",
			(snap) => snap.prompt?.message === "Paste the authorization code",
		);
		expect(prompted.status).toBe("waiting");

		const continued = continueOAuthLogin(result.loginId ?? "", "pasted-code");
		expect(continued.status).toBe("waiting");
		expect(continued.prompt).toBeUndefined();
	});

	it("continue answers only the current waiter", async () => {
		let promptAnswer: string | undefined;
		let manualAnswer: string | undefined;
		const result = startOAuthLogin("anthropic", {
			login: hangingLogin((callbacks) => {
				void callbacks.onPrompt({ message: "prompt" }).then(
					(value) => {
						promptAnswer = value;
					},
					() => {},
				);
				void callbacks.onManualCodeInput?.().then(
					(value) => {
						manualAnswer = value;
					},
					() => {},
				);
			}),
			reloadAuth: () => {},
			listProviders: () => [],
		});

		await waitForLogin(result.loginId ?? "", (snap) => Boolean(snap.prompt));
		continueOAuthLogin(result.loginId ?? "", "only-latest");
		await new Promise((resolve) => {
			setTimeout(resolve, 20);
		});

		const answered = [promptAnswer, manualAnswer].filter((value) => value === "only-latest");
		expect(answered).toHaveLength(1);
	});

	it("returns success and the provider catalog when login completes", async () => {
		const providers = [
			{
				id: "github-copilot",
				name: "GitHub Copilot",
				isConfigured: true,
				envVarName: "",
				authType: "oauth" as const,
			},
		];
		let reloaded = false;

		const result = startOAuthLogin("github-copilot", {
			login: completingLogin((callbacks) => {
				callbacks.onAuth({
					url: "https://github.com/login/device",
					instructions: "Enter code: DONE-1",
				});
			}),
			reloadAuth: () => {
				reloaded = true;
			},
			listProviders: () => providers,
		});

		expect(result.status).toBe("waiting");
		const completed = await waitForLogin(
			result.loginId ?? "",
			(snap) => snap.status === "success" || snap.status === "error",
		);
		expect(completed.status).toBe("success");
		expect(completed.providers).toEqual(providers);
		expect(reloaded).toBe(true);
		expect(pollOAuthLogin(result.loginId ?? "")).toEqual(completed);
		expect(pollOAuthLogin(result.loginId ?? "")).toEqual(completed);
	});

	it("cancels an in-flight login before onAuth", () => {
		const result = startOAuthLogin("github-copilot", {
			login: hangingLogin(() => {}),
			reloadAuth: () => {},
			listProviders: () => [],
		});

		const cancelled = cancelOAuthLogin(result.loginId ?? "");
		expect(cancelled.status).toBe("error");
		expect(cancelled.error).toBe("Login cancelled");
		expect(pollOAuthLogin(result.loginId ?? "").error).toBe("Unknown or expired OAuth login");
	});
});

describe("handleChatProvidersOAuthPost", () => {
	it("rejects unknown OAuth providers", async () => {
		const response = await handleChatProvidersOAuthPost(
			new Request("http://localhost/api/chat/providers/oauth", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ providerId: "not-a-provider" }),
			}),
		);

		expect(response.status).toBe(400);
		const body = (await response.json()) as { status: string; error: string };
		expect(body.status).toBe("error");
		expect(body.error).toContain("Unknown OAuth provider");
	});
});
