import { notify as toast } from "@prime-agent/web-design/lib/notify";
import type {
	ChatProviderOAuthLoginRequest,
	ChatProviderOAuthLoginResponse,
} from "@prime-agent/web-protocol/chat-protocol";
import { useCallback, useEffect, useRef, useState } from "react";

const OAUTH_POLL_MS = 1500;
const STALE_LOGIN_ERROR = "Unknown or expired OAuth login";

export type UseOAuthLoginFlowArgs = {
	onConfigured?: () => void;
	onOAuthLogin?: (request: ChatProviderOAuthLoginRequest) => Promise<ChatProviderOAuthLoginResponse>;
	providerId: string;
};

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

export function useOAuthLoginFlow({ onConfigured, onOAuthLogin, providerId }: UseOAuthLoginFlowArgs) {
	const [login, setLogin] = useState<ChatProviderOAuthLoginResponse | null>(null);
	const [busy, setBusy] = useState(false);
	const [promptAnswer, setPromptAnswer] = useState("");
	const loginIdRef = useRef<string | null>(null);
	const generationRef = useRef(0);
	const startingRef = useRef(false);
	const onOAuthLoginRef = useRef(onOAuthLogin);
	const onConfiguredRef = useRef(onConfigured);
	const providerIdRef = useRef(providerId);

	useEffect(() => {
		onOAuthLoginRef.current = onOAuthLogin;
		onConfiguredRef.current = onConfigured;
		providerIdRef.current = providerId;
	}, [onConfigured, onOAuthLogin, providerId]);

	const cancelLoginId = useCallback(async (loginId: string | null) => {
		if (!loginId || !onOAuthLoginRef.current) return;
		try {
			await onOAuthLoginRef.current({
				providerId: providerIdRef.current,
				loginId,
				cancel: true,
			});
		} catch {
			// Session may already have been dropped.
		}
	}, []);

	const resetLocal = useCallback(() => {
		loginIdRef.current = null;
		startingRef.current = false;
		setLogin(null);
		setPromptAnswer("");
		setBusy(false);
	}, []);

	useEffect(() => {
		return () => {
			generationRef.current += 1;
			const loginId = loginIdRef.current;
			loginIdRef.current = null;
			void cancelLoginId(loginId);
		};
	}, [cancelLoginId]);

	const applyResult = useCallback(
		(result: ChatProviderOAuthLoginResponse, generation: number) => {
			if (generation !== generationRef.current) {
				if (result.status === "waiting" && result.loginId) {
					void cancelLoginId(result.loginId);
				}
				return;
			}
			if (result.status === "success") {
				loginIdRef.current = null;
				setLogin(null);
				setPromptAnswer("");
				setBusy(false);
				toast.success("Provider credentials applied to your active sessions.");
				onConfiguredRef.current?.();
				return;
			}
			if (result.status === "error") {
				if (result.error === STALE_LOGIN_ERROR && loginIdRef.current === null) {
					return;
				}
				const loginId = loginIdRef.current;
				loginIdRef.current = null;
				if (loginId && result.error !== "Login cancelled") {
					void cancelLoginId(loginId);
				}
				setLogin(result);
				setBusy(false);
				return;
			}
			if (result.loginId) {
				loginIdRef.current = result.loginId;
			}
			setLogin(result);
		},
		[cancelLoginId],
	);

	const start = useCallback(async () => {
		if (!onOAuthLoginRef.current || startingRef.current) return;
		startingRef.current = true;
		const generation = generationRef.current;
		setBusy(true);
		const previous = loginIdRef.current;
		loginIdRef.current = null;
		setLogin(null);
		await cancelLoginId(previous);
		if (generation !== generationRef.current) {
			startingRef.current = false;
			return;
		}
		try {
			const result = await onOAuthLoginRef.current({
				providerId: providerIdRef.current,
			});
			applyResult(result, generation);
		} catch (error) {
			if (generation !== generationRef.current) return;
			setLogin({
				status: "error",
				error: error instanceof Error ? error.message : "Failed to start OAuth sign-in",
			});
		} finally {
			startingRef.current = false;
			if (generation === generationRef.current) {
				setBusy(false);
			}
		}
	}, [applyResult, cancelLoginId]);

	const submitPrompt = useCallback(async () => {
		const loginId = loginIdRef.current;
		if (!onOAuthLoginRef.current || !loginId) return;
		const generation = generationRef.current;
		setBusy(true);
		try {
			const result = await onOAuthLoginRef.current({
				providerId: providerIdRef.current,
				loginId,
				promptAnswer,
			});
			setPromptAnswer("");
			applyResult(result, generation);
		} catch (error) {
			if (generation !== generationRef.current) return;
			toast.error(error instanceof Error ? error.message : "Failed to continue OAuth sign-in");
		} finally {
			if (generation === generationRef.current) {
				setBusy(false);
			}
		}
	}, [applyResult, promptAnswer]);

	const cancel = useCallback(async () => {
		generationRef.current += 1;
		const loginId = loginIdRef.current;
		resetLocal();
		await cancelLoginId(loginId);
	}, [cancelLoginId, resetLocal]);

	useEffect(() => {
		if (!onOAuthLoginRef.current) return;
		if (login?.status !== "waiting" || !login.loginId) return;
		const generation = generationRef.current;
		const loginId = login.loginId;
		let stopped = false;

		const poll = async () => {
			while (!stopped) {
				try {
					const result = await onOAuthLoginRef.current!({
						providerId: providerIdRef.current,
						loginId,
					});
					if (stopped || generation !== generationRef.current) return;
					applyResult(result, generation);
					if (result.status !== "waiting") return;
				} catch (error) {
					if (stopped || generation !== generationRef.current) return;
					if (loginIdRef.current !== loginId) return;
					loginIdRef.current = null;
					void cancelLoginId(loginId);
					setLogin({
						status: "error",
						error: error instanceof Error ? error.message : "OAuth sign-in failed",
					});
					return;
				}
				await delay(OAUTH_POLL_MS);
				if (stopped || generation !== generationRef.current) return;
				if (loginIdRef.current !== loginId) return;
			}
		};

		void poll();
		return () => {
			stopped = true;
		};
	}, [applyResult, cancelLoginId, login?.loginId, login?.status]);

	return {
		busy,
		cancel,
		canStart: Boolean(onOAuthLogin),
		login,
		promptAnswer,
		setPromptAnswer,
		start,
		submitPrompt,
	};
}
