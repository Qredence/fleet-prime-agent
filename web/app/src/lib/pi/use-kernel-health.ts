import { useEffect, useState } from "react";

export type KernelHealth = {
	ok: boolean;
	reason?: string;
};

export function useKernelHealth(pollMs = 15_000) {
	const [kernel, setKernel] = useState<KernelHealth | null>(null);

	useEffect(() => {
		let cancelled = false;
		const tick = async () => {
			try {
				const response = await fetch("/api/health");
				const body = (await response.json()) as { kernel?: KernelHealth };
				if (!cancelled && body.kernel) setKernel(body.kernel);
			} catch {
				if (!cancelled) setKernel({ ok: false, reason: "unreachable" });
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
