import type { PluginAPI, ShellResult } from "@ampcode/plugin"

export const description =
	"Runs Fleet Prime's bundle, React render, and browser performance checks with selectable lanes and concise reports."

const CHECKS = ["bundle", "render", "browser"] as const
type PerformanceCheck = (typeof CHECKS)[number]

const DEFAULT_BROWSER_URL = "http://127.0.0.1:3000"
const MAX_OUTPUT_CHARACTERS = 12_000

interface PerformanceInput {
	checks?: unknown
	baseUrl?: unknown
}

interface PerformanceResult {
	check: PerformanceCheck
	result: ShellResult
}

function parseChecks(value: unknown): PerformanceCheck[] {
	if (value === undefined) return [...CHECKS]
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`checks must be a non-empty array containing only: ${CHECKS.join(", ")}.`)
	}

	const invalid = value.filter(
		(entry): entry is unknown =>
			typeof entry !== "string" || !CHECKS.includes(entry as PerformanceCheck),
	)
	if (invalid.length > 0) {
		throw new Error(`Unknown performance check: ${String(invalid[0])}. Choose from: ${CHECKS.join(", ")}.`)
	}

	return [...new Set(value as PerformanceCheck[])]
}

function parseBaseUrl(value: unknown): string {
	if (value === undefined) return DEFAULT_BROWSER_URL
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error("baseUrl must be a non-empty HTTP(S) URL.")
	}

	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw new Error("baseUrl must be a valid HTTP(S) URL.")
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("baseUrl must use http:// or https://.")
	}
	if (url.username || url.password) {
		throw new Error("baseUrl must not contain credentials.")
	}

	return url.toString()
}

function formatOutput(result: ShellResult): string {
	const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n")
	if (output.length === 0) return "(command produced no output)"
	if (output.length <= MAX_OUTPUT_CHARACTERS) return output
	return `${output.slice(0, MAX_OUTPUT_CHARACTERS)}\n… output truncated …`
}

function formatResult({ check, result }: PerformanceResult): string {
	const status = result.exitCode === 0 ? "PASS" : "FAIL"
	return [`### ${check} [${status}]`, `exit code: ${result.exitCode}`, formatOutput(result)].join("\n")
}

function commandFailure(error: unknown): ShellResult {
	return {
		exitCode: 1,
		stdout: "",
		stderr: error instanceof Error ? error.message : String(error),
	}
}

export default function registerFrontendPerformance(amp: PluginAPI) {
	amp.registerTool({
		name: "measure-frontend-performance",
		title: "Measure frontend performance",
		transcriptGroup: {
			active: "Measuring frontend performance",
			complete: "Measured frontend performance",
		},
		description:
			"Run Fleet Prime's existing frontend performance checks. By default, run the production bundle budget, React render benchmark, and browser performance smoke tests. Select checks to run only specific lanes.",
		inputSchema: {
			type: "object",
			properties: {
				checks: {
					type: "array",
					items: { type: "string", enum: [...CHECKS] },
					description: "Optional checks to run: bundle, render, or browser. Defaults to all three.",
				},
				baseUrl: {
					type: "string",
					description:
						"HTTP(S) URL for the browser check. Defaults to the local Fleet Prime dev server at http://127.0.0.1:3000.",
				},
			},
			additionalProperties: false,
		},
		async execute(input) {
			const options = input as PerformanceInput
			const checks = parseChecks(options.checks)
			const baseUrl = parseBaseUrl(options.baseUrl)
			const workspaceRoot = amp.system.workspaceRoot
			if (!workspaceRoot) {
				throw new Error("Frontend performance checks require an open workspace.")
			}
			const workspacePath = amp.helpers.filePathFromURI(workspaceRoot)
			const results: PerformanceResult[] = []

			for (const check of checks) {
				let result: ShellResult
				try {
					switch (check) {
						case "bundle":
							result = await amp.$`pnpm --dir ${workspacePath} --filter @prime-agent/web build && pnpm --dir ${workspacePath} --filter @prime-agent/web run check:bundle`
							break
						case "render":
							result = await amp.$`pnpm --dir ${workspacePath} --filter @prime-agent/web run bench`
							break
						case "browser":
							result = await amp.$`env PLAYWRIGHT_BASE_URL=${baseUrl} pnpm --dir ${workspacePath} --filter @prime-agent/web exec playwright test playwright/perf-smoke.spec.ts`
							break
					}
				} catch (error) {
					result = commandFailure(error)
				}
				results.push({ check, result })
			}

			const passed = results.every(({ result }) => result.exitCode === 0)
			return [
				`Frontend performance measurements: ${passed ? "PASS" : "FAIL"}`,
				`checks: ${checks.join(", ")}`,
				`browser URL: ${baseUrl}`,
				...results.map(formatResult),
			].join("\n\n")
		},
	})
}
