import { useEffect, useState } from "react";
import { resolveChatApiUrl } from "./chat-runtime-url";

export type KernelHealth = {
	ok: boolean;
	reason?: string;
};

function isKernelHealth(value: unknown): value is KernelHealth {
	return typeof value === "object" && value !== null && typeof (value as { ok?: unknown }).ok === "boolean";
}

export function useKernelHealth(pollMs = 15_000) {
	const [kernel, setKernel] = useState<KernelHealth | null>(null);

	useEffect(() => {
		let cancelled = false;
		const tick = async () => {
			try {
				const response = await fetch(resolveChatApiUrl("/api/health"));
				if (!response.ok) throw new Error(`http-${response.status}`);
				const body = (await response.json()) as { kernel?: unknown };
				if (!isKernelHealth(body.kernel)) throw new Error("invalid-response");
				if (!cancelled) setKernel(body.kernel);
			} catch (error) {
				if (!cancelled) {
					setKernel({
						ok: false,
						reason: error instanceof Error ? error.message : "unreachable",
					});
				}
			}
		};
		void tick();
		const id = setInterval(() => void tick(), pollMs);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [pollMs]);

	return kernel;
}
