export function pnpmInvocation(args) {
	const pinnedLauncher = process.env.FLEET_PNPM_BIN;
	if (!pinnedLauncher) return { command: "pnpm", args: [...args] };
	return { command: process.execPath, args: [pinnedLauncher, ...args] };
}
