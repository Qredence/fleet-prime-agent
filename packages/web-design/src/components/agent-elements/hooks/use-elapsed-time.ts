import { useEffect, useState } from "react";

export function useElapsedTime(startedAt: number | undefined, isPending: boolean): number {
	const [elapsedMs, setElapsedMs] = useState(0);

	useEffect(() => {
		if (isPending && startedAt) {
			setElapsedMs(Date.now() - startedAt);
			const interval = setInterval(() => {
				setElapsedMs(Date.now() - startedAt);
			}, 1000);
			return () => clearInterval(interval);
		}
	}, [isPending, startedAt]);

	return elapsedMs;
}
