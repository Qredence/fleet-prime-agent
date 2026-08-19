import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getPackageDir } from "../config.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;
const WORKSPACE_ROOT_ENV = "PRIME_AGENT_WORKSPACE_ROOT";

export interface FleetPrimeCommandOptions {
	host: string;
	port: number;
	workspaceRoot: string;
}

export function parseFleetPrimeCommandOptions(
	args: readonly string[],
	environment = process.env,
): FleetPrimeCommandOptions {
	let host = DEFAULT_HOST;
	let port = DEFAULT_PORT;
	let workspaceRoot: string | undefined;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]!;
		if (arg === "--host" || arg === "--port" || arg === "--cwd") {
			const value = args[index + 1];
			if (!value || value.startsWith("-")) {
				throw new Error(`${arg} requires a value`);
			}
			index += 1;
			if (arg === "--host") host = parseHost(value);
			else if (arg === "--port") port = parsePort(value);
			else workspaceRoot = value;
			continue;
		}

		if (arg.startsWith("--host=")) {
			host = parseHost(arg.slice("--host=".length));
			continue;
		}
		if (arg.startsWith("--port=")) {
			port = parsePort(arg.slice("--port=".length));
			continue;
		}
		if (arg.startsWith("--cwd=")) {
			workspaceRoot = arg.slice("--cwd=".length);
			if (!workspaceRoot) throw new Error("--cwd requires a value");
			continue;
		}

		throw new Error(`Unknown option for fleet-prime: ${arg}`);
	}

	const configuredRoot = workspaceRoot ?? environment[WORKSPACE_ROOT_ENV] ?? process.cwd();
	const resolvedRoot = resolve(configuredRoot);
	if (!existsSync(resolvedRoot)) {
		throw new Error(`Workspace directory does not exist: ${resolvedRoot}`);
	}
	if (!statSync(resolvedRoot).isDirectory()) {
		throw new Error(`Workspace path is not a directory: ${resolvedRoot}`);
	}

	return { host, port, workspaceRoot: resolvedRoot };
}

export async function runFleetPrimeCommand(args: readonly string[]): Promise<void> {
	let options: FleetPrimeCommandOptions;
	try {
		options = parseFleetPrimeCommandOptions(args);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`${message}\nRun "fleet-prime --help" for usage.`);
	}
	const launcherPath = join(getPackageDir(), "dist", "web", "launcher.mjs");
	if (!existsSync(launcherPath)) {
		throw new Error(
			`The packaged web runtime is unavailable at ${launcherPath}. Install a Qredence release with web support, or run the source development command from the repository.`,
		);
	}

	const child = spawn(process.execPath, [launcherPath, "--host", options.host, "--port", String(options.port)], {
		cwd: options.workspaceRoot,
		env: { ...process.env, [WORKSPACE_ROOT_ENV]: options.workspaceRoot },
		stdio: "inherit",
	});

	await waitForFleetPrimeProcess(child);
}

function parseHost(value: string): string {
	const host = value.trim();
	if (!host) throw new Error("--host requires a non-empty value");
	if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
		throw new Error(`Invalid Fleet Prime host: ${host}. Fleet Prime accepts loopback hosts only.`);
	}
	return host;
}

function parsePort(value: string): number {
	if (!/^\d+$/.test(value)) {
		throw new Error(`Invalid web port: ${value}`);
	}
	const port = Number(value);
	if (!Number.isSafeInteger(port) || port < 0 || port > MAX_PORT) {
		throw new Error(`Invalid web port: ${value}. Expected a number between 0 and ${MAX_PORT}.`);
	}
	return port;
}

export function waitForFleetPrimeProcess(child: ChildProcess): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		let settled = false;
		const forwardSignal = (signal: NodeJS.Signals) => {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill(signal);
			}
		};
		const forwardInterrupt = () => forwardSignal("SIGINT");
		const forwardTermination = () => forwardSignal("SIGTERM");

		const cleanup = () => {
			process.off("SIGINT", forwardInterrupt);
			process.off("SIGTERM", forwardTermination);
			child.off("error", handleError);
			child.off("exit", handleExit);
		};

		const settle = (callback: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			callback();
		};

		const handleError = (error: Error) => settle(() => reject(error));
		const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
			settle(() => {
				if (signal) {
					process.exitCode = 128 + signalExitCode(signal);
				} else if (code !== null && code !== 0) {
					process.exitCode = code;
				}
				resolvePromise();
			});
		};

		process.once("SIGINT", forwardInterrupt);
		process.once("SIGTERM", forwardTermination);
		child.once("error", handleError);
		child.once("exit", handleExit);
	});
}

function signalExitCode(signal: NodeJS.Signals): number {
	if (signal === "SIGINT") return 2;
	if (signal === "SIGTERM") return 15;
	return 1;
}
