import { Link } from "@tanstack/react-router";

export function ProductPageHeader({ active }: { active: "agents" | "connectors" }) {
	return (
		<header className="flex h-14 items-center justify-between border-b border-border/70 px-5 sm:px-8">
			<Link to="/" className="text-sm font-semibold tracking-tight">
				Fleet Prime
			</Link>
			<nav aria-label="Main navigation" className="flex items-center gap-1">
				<NavLink active={active === "agents"} to="/agents">
					Agents
				</NavLink>
				<NavLink active={active === "connectors"} to="/connectors">
					Connectors
				</NavLink>
			</nav>
		</header>
	);
}

function NavLink({
	active,
	children,
	to,
}: {
	active: boolean;
	children: React.ReactNode;
	to: "/agents" | "/connectors";
}) {
	return (
		<Link
			to={to}
			aria-current={active ? "page" : undefined}
			className={`rounded-md px-3 py-1.5 text-sm transition-colors ${active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`}
		>
			{children}
		</Link>
	);
}
