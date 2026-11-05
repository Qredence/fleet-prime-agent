export interface PrimeRuntimeAsset {
	archive: string;
	sha256: string;
	executableSha256: string;
}

export interface PrimeRuntimeManifest {
	rust: { version: string; baseUrl: string; platforms: Record<string, PrimeRuntimeAsset | undefined> };
}

export function runtimeTarget(os?: string, cpu?: string): string;

export function ensurePrimeRuntime(options: {
	manifest: PrimeRuntimeManifest;
	installRoot?: string;
	home?: string;
	fetch?: typeof fetch;
	target?: string;
}): Promise<string>;
