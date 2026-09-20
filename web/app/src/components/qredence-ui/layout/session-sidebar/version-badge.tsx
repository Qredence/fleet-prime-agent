import { Badge } from "@/components/ui/badge";
import { fleetVersion } from "@/lib/fleet-version";

/**
 * Released Fleet package version shown in the session sidebar footer.
 * Informational only; never interactive.
 */
export function VersionBadge() {
	const version = fleetVersion();
	return (
		<Badge
			variant="secondary"
			title={`Fleet ${version}`}
			aria-label={`Fleet version ${version}`}
			className="shrink-0 font-mono text-micro font-normal text-muted-foreground"
		>
			v{version}
		</Badge>
	);
}
