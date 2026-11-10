import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const LOADER_DOTS = ["·", "•", "●", "•"];

function ComposerLoaderActive({ label, className }: { label: string; className?: string }) {
	const [elapsed, setElapsed] = useState(0);
	const [tick, setTick] = useState(0);

	useEffect(() => {
		const startedAt = Date.now();
		const interval = window.setInterval(() => {
			setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
			setTick((current) => current + 1);
		}, 500);
		return () => window.clearInterval(interval);
	}, []);

	return (
		<div className={cn("flex items-center gap-2 px-chat-context py-1 text-xs text-foreground/70", className)}>
			<span aria-hidden="true" className="font-mono text-primary">
				{LOADER_DOTS[tick % LOADER_DOTS.length]}
			</span>
			<span className="sr-only" aria-live="polite">
				{label}
			</span>
			<span aria-hidden="true" className="truncate">
				{label}
			</span>
			<span aria-hidden="true" className="tabular-nums text-foreground/50">
				{elapsed}s
			</span>
		</div>
	);
}

/**
 * Mirrors the TUI's working-loader: a tiny animated indicator, the current
 * activity verb (Working / Waiting / Thinking / Writing / Executing), and
 * elapsed seconds since the current turn started. The TUI also surfaces
 * token counts; the web port shows them when they arrive via the info
 * description (see InputBar `infoDescription`).
 */
export function ComposerLoader({
	label,
	isActive,
	className,
}: {
	label?: string;
	isActive: boolean;
	className?: string;
}) {
	if (!isActive || !label) return null;

	return <ComposerLoaderActive label={label} className={className} />;
}
