/**
 * Builds the command invocation used to run pnpm.
 * @param {string[]} args - Arguments to pass to pnpm.
 * @returns {{command: string, args: string[]}} The command and arguments for the pnpm invocation.
 */
export function pnpmInvocation(args) {
	const pinnedLauncher = process.env.FLEET_PNPM_BIN;
	if (!pinnedLauncher) return { command: "pnpm", args: [...args] };
	return { command: process.execPath, args: [pinnedLauncher, ...args] };
}
