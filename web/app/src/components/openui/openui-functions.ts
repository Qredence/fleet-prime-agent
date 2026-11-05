import { defineFunction } from "@openuidev/react-lang";
import { z } from "zod/v4";

/**
 * Client-side `@functions` available to generated OpenUI programs.
 *
 * The model writes the call; the renderer runs the code. That keeps derived
 * values (durations, byte sizes, percentages, token counts) out of the model's
 * hands, where they would otherwise be guessed or drift from the data.
 *
 * Every function must be pure and synchronous: the renderer may call it any
 * number of times, in any order, and a throw is reported as a `runtime-error`
 * that nulls the call instead of breaking the page.
 */

const DURATION_UNITS: ReadonlyArray<readonly [number, string]> = [
	[86_400_000, "d"],
	[3_600_000, "h"],
	[60_000, "m"],
	[1_000, "s"],
];

function formatDuration(ms: number): string {
	const total = Math.max(0, ms);
	if (total < 1_000) return `${Math.round(total)}ms`;
	const whole = DURATION_UNITS.find(([size]) => total >= size);
	if (!whole) return `${Math.round(total)}ms`;
	const [size, suffix] = whole;
	const value = total / size;
	const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
	return `${rounded}${suffix}`;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

function formatBytes(bytes: number): string {
	const total = Math.max(0, bytes);
	if (total < 1_024) return `${Math.round(total)} B`;
	let value = total;
	let unit = 0;
	while (value >= 1_024 && unit < BYTE_UNITS.length - 1) {
		value /= 1_024;
		unit += 1;
	}
	return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${BYTE_UNITS[unit]}`;
}

function formatTokens(count: number): string {
	const total = Math.max(0, count);
	if (total < 1_000) return String(Math.round(total));
	if (total < 1_000_000) return `${Math.round(total / 100) / 10}k`;
	return `${Math.round(total / 100_000) / 10}M`;
}

function formatPercent(part: number, total: number, decimals: number): string {
	if (total === 0) return "0%";
	const value = (part / total) * 100;
	const factor = 10 ** Math.round(Math.max(0, Math.min(decimals, 3)));
	return `${Math.round(value * factor) / factor}%`;
}

function formatRelativeTime(iso: string): string {
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return iso;
	return formatDuration(Date.now() - then)
		.replace(/^(\d+(?:\.\d+)?)d$/, "$1d ago")
		.replace(/^(\d+(?:\.\d+)?)(h|m|s|ms)$/, "$1$2 ago")
		.replace(/^now$/, "just now");
}

function formatShortPath(path: string, segments: number): string {
	const parts = path.split("/").filter(Boolean);
	const keep = Math.max(1, Math.min(segments, 6));
	if (parts.length <= keep) return path;
	return `…/${parts.slice(-keep).join("/")}`;
}

const durationFunction = defineFunction({
	name: "Duration",
	description: "Formats a millisecond count as a short human duration, for example 90m or 2.5h.",
	params: z.object({
		ms: z.number().describe("Duration in milliseconds"),
	}),
	returns: z.string(),
	fn: ({ ms }) => formatDuration(ms),
});

const bytesFunction = defineFunction({
	name: "Bytes",
	description: "Formats a byte count as a short human size, for example 1.2 MB.",
	params: z.object({
		bytes: z.number().describe("Size in bytes"),
	}),
	returns: z.string(),
	fn: ({ bytes }) => formatBytes(bytes),
});

const tokensFunction = defineFunction({
	name: "Tokens",
	description:
		"Formats a token count compactly, for example 38.2k. Use it for model usage rather than writing the number by hand.",
	params: z.object({
		count: z.number().describe("Number of tokens"),
	}),
	returns: z.string(),
	fn: ({ count }) => formatTokens(count),
});

const percentFunction = defineFunction({
	name: "Percent",
	description: "Formats part / total as a percentage. Use it instead of computing a ratio by hand.",
	params: z.object({
		part: z.number(),
		total: z.number().default(100),
		decimals: z.number().default(1).describe("Decimal places (0-3)"),
	}),
	returns: z.string(),
	fn: ({ part, total, decimals }) => formatPercent(part, total, decimals),
});

const relativeTimeFunction = defineFunction({
	name: "RelativeTime",
	description: "Turns an ISO timestamp into a short relative age, for example 3h ago.",
	params: z.object({
		iso: z.string().describe("ISO 8601 timestamp"),
	}),
	returns: z.string(),
	fn: ({ iso }) => formatRelativeTime(iso),
});

const shortPathFunction = defineFunction({
	name: "ShortPath",
	description: "Shortens a workspace-relative path to its last N segments for narrow columns.",
	params: z.object({
		path: z.string(),
		segments: z.number().default(2).describe("Number of trailing segments to keep (1-6)"),
	}),
	returns: z.string(),
	fn: ({ path, segments }) => formatShortPath(path, segments),
});

export const openUIFunctions = [
	durationFunction,
	bytesFunction,
	tokensFunction,
	percentFunction,
	relativeTimeFunction,
	shortPathFunction,
];
