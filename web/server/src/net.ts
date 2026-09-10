/** Strict loopback check shared by the origin guard and fetch lockdown. */
export function isLoopbackHostname(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/\.$/, "");
	if (host === "localhost") return true;
	const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	const mapped = bare.startsWith("::ffff:") ? bare.slice("::ffff:".length) : bare;
	if (mapped === "::1" || mapped === "0:0:0:0:0:0:0:1") return true;
	if (mapped.startsWith("127.")) {
		const parts = mapped.split(".");
		if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return true;
	}
	return false;
}
