import type {
	ChatResourceInfo,
	ChatResourcesResponse,
	WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol";
import { CircleAlert, type LucideIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { getResourceChipTitle, getResourceGroups, resourceKey } from "@/lib/workspace/resource-helpers";

/**
 * Renders a list of resource items for a given category inside the Resources or Workspace panel.
 */
export function ResourceChipSection({
	id,
	icon: Icon,
	items,
	label,
}: {
	id: string;
	icon: LucideIcon;
	items: Array<ChatResourceInfo>;
	label: string;
}) {
	return (
		<section
			id={`resource-section-${id}`}
			className="flex min-w-0 flex-col gap-2 py-2.5"
			aria-label={`${label} resources`}
		>
			<div className="flex min-w-0 items-center text-sm text-muted-foreground">
				<span className="truncate underline decoration-foreground/25 underline-offset-2">{label}</span>
				<span className="ml-1 shrink-0 text-xs text-muted-foreground/70 tabular-nums no-underline">
					{items.length}
				</span>
			</div>
			<ul
				className="flex min-w-0 flex-col items-stretch gap-1.5"
				data-testid={`resource-chip-section-${label.toLowerCase()}`}
			>
				{items.length === 0 ? (
					<li className="inline-flex h-7.5 items-center rounded-lg border border-border/60 bg-background px-3 text-sm text-muted-foreground/80 shadow-xs">
						Empty
					</li>
				) : (
					items.map((item) => {
						const title = getResourceChipTitle(item);
						return (
							<Item
								key={resourceKey(item)}
								variant="outline"
								size="xs"
								render={<li aria-label={title} data-testid="resource-chip" title={title} />}
								className="min-h-9 bg-background text-foreground/80 shadow-xs"
							>
								<ItemMedia className="size-5 rounded-full bg-muted text-muted-foreground">
									<Icon aria-hidden="true" />
								</ItemMedia>
								<ItemContent>
									<ItemTitle className="truncate">{item.name}</ItemTitle>
								</ItemContent>
								{item.source ? (
									<Badge variant="secondary" className="max-w-20 shrink-0 truncate px-1.5 py-0.5 text-xs">
										{item.source}
									</Badge>
								) : null}
								{item.activationStatus ? (
									<Badge variant="secondary" className="max-w-24 shrink-0 truncate px-1.5 py-0.5 text-xs">
										{item.activationStatus}
									</Badge>
								) : null}
							</Item>
						);
					})
				)}
			</ul>
		</section>
	);
}

function ResourcesSkeleton() {
	return (
		<div className="flex flex-col gap-4 p-1">
			<div className="flex flex-col gap-2">
				<Skeleton className="h-4 w-24" />
				<div className="flex flex-wrap gap-1.5">
					<Skeleton className="h-7 w-20 rounded-full" />
					<Skeleton className="h-7 w-24 rounded-full" />
					<Skeleton className="h-7 w-16 rounded-full" />
					<Skeleton className="h-7 w-28 rounded-full" />
				</div>
			</div>
			<div className="flex flex-col gap-2">
				<Skeleton className="h-4 w-28" />
				<div className="flex flex-wrap gap-1.5">
					<Skeleton className="h-7 w-22 rounded-full" />
					<Skeleton className="h-7 w-18 rounded-full" />
					<Skeleton className="h-7 w-26 rounded-full" />
				</div>
			</div>
			<div className="flex flex-col gap-2">
				<Skeleton className="h-4 w-20" />
				<div className="flex flex-wrap gap-1.5">
					<Skeleton className="h-7 w-24 rounded-full" />
					<Skeleton className="h-7 w-20 rounded-full" />
					<Skeleton className="h-7 w-30 rounded-full" />
				</div>
			</div>
		</div>
	);
}

/**
 * Displays loaded skills, extensions, and other session resources.
 */
export function ResourcesPanelContent({
	error,
	loading,
	resources,
	workspace,
}: {
	error?: Error | null;
	loading: boolean;
	resources: ChatResourcesResponse | null;
	workspace: WorkspaceTreeResponse | null;
}) {
	const groups = getResourceGroups(resources, workspace);

	return (
		<>
			{error ? (
				<Alert className="my-1.5">
					<CircleAlert />
					<AlertTitle>Unable to load resources</AlertTitle>
					<AlertDescription>{error.message}</AlertDescription>
				</Alert>
			) : null}
			{!error && loading && !resources ? <ResourcesSkeleton /> : null}
			{!error && resources ? groups.map((group) => <ResourceChipSection key={group.id} {...group} />) : null}
		</>
	);
}
