export function getPiUserAgent(version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	const safeVersion = /^[0-9A-Za-z.+-]+$/.test(version) ? version : "unknown";
	return `prime-agent/${safeVersion} (${process.platform}; ${runtime}; ${process.arch})`;
}
