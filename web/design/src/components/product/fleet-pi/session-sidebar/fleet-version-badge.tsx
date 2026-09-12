import { fleetVersion } from "../../../../lib/fleet-version";
import { Badge } from "../../../ui/badge";

/**
 * Released Fleet package version shown in the session sidebar footer.
 * Informational only; never interactive.
 */
export function FleetVersionBadge() {
	const version = fleetVersion();
	return (
		<Badge
			variant="secondary"
			title={`Fleet ${version}`}
			aria-label={`Fleet version ${version}`}
			className="shrink-0 font-mono text-[0.625rem] font-normal text-muted-foreground"
		>
			v{version}
		</Badge>
	);
}
