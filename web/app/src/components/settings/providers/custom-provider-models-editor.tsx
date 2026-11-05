import { Layers, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

/** Progressive list page size for large custom-provider catalogs in settings. */
export const CUSTOM_PROVIDER_MODELS_PAGE_SIZE = 40;

export function CustomProviderModelsEditor({
	attemptedSave,
	modelIds,
	onChange,
}: {
	attemptedSave: boolean;
	modelIds: Array<string>;
	onChange: (modelIds: Array<string>) => void;
}) {
	const [filter, setFilter] = useState("");
	const [newModelId, setNewModelId] = useState("");
	const [visibleCount, setVisibleCount] = useState(CUSTOM_PROVIDER_MODELS_PAGE_SIZE);
	const normalizedFilter = filter.trim().toLowerCase();

	const filteredModelIds = useMemo(() => {
		if (!normalizedFilter) return modelIds;
		return modelIds.filter((id) => id.toLowerCase().includes(normalizedFilter));
	}, [modelIds, normalizedFilter]);

	const visibleModelIds = useMemo(() => filteredModelIds.slice(0, visibleCount), [filteredModelIds, visibleCount]);

	const showEmptyError = attemptedSave && modelIds.length === 0;
	const canLoadMore = visibleModelIds.length < filteredModelIds.length;

	const addModelId = () => {
		const trimmed = newModelId.trim();
		if (!trimmed) return;
		if (modelIds.includes(trimmed)) {
			setNewModelId("");
			return;
		}
		onChange([...modelIds, trimmed]);
		setNewModelId("");
	};

	const removeModelId = (id: string) => {
		onChange(modelIds.filter((entry) => entry !== id));
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-col gap-1">
				<span className="text-xs font-medium text-muted-foreground">Model ids</span>
				<InputGroup>
					<InputGroupAddon align="inline-start">
						<Search />
					</InputGroupAddon>
					<InputGroupInput
						aria-label="Search model ids"
						placeholder="Search models…"
						value={filter}
						onChange={(event) => {
							setFilter(event.target.value);
							setVisibleCount(CUSTOM_PROVIDER_MODELS_PAGE_SIZE);
						}}
					/>
				</InputGroup>
			</div>

			<div
				className={cn(
					"max-h-48 overflow-y-auto overscroll-contain rounded-lg border border-border/60 bg-muted/20",
					showEmptyError && "border-destructive/60",
				)}
				aria-live="polite"
			>
				{filteredModelIds.length === 0 ? (
					<p className="px-3 py-4 text-center text-xs text-pretty text-muted-foreground">
						{modelIds.length === 0
							? "Add at least one model id for this provider."
							: "No model ids match your search."}
					</p>
				) : (
					<ul className="flex flex-col divide-y divide-border/40">
						{visibleModelIds.map((id) => (
							<li key={id} className="flex items-center gap-2 px-2 py-1.5">
								<Layers aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate font-mono text-xs">{id}</span>
								<Button
									type="button"
									variant="ghost"
									size="icon-compact"
									className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
									aria-label={`Remove model ${id}`}
									onClick={() => removeModelId(id)}
								>
									<X />
								</Button>
							</li>
						))}
					</ul>
				)}
			</div>

			{canLoadMore ? (
				<Button
					type="button"
					variant="outline"
					size="compact"
					className="self-start"
					onClick={() => setVisibleCount((current) => current + CUSTOM_PROVIDER_MODELS_PAGE_SIZE)}
				>
					Load more ({filteredModelIds.length - visibleModelIds.length} remaining)
				</Button>
			) : null}

			<div className="flex items-center gap-1.5">
				<InputGroup className="flex-1">
					<InputGroupAddon align="inline-start">
						<Plus />
					</InputGroupAddon>
					<InputGroupInput
						aria-label="Add model id"
						placeholder="Add model id…"
						value={newModelId}
						onChange={(event) => setNewModelId(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								addModelId();
							}
						}}
					/>
				</InputGroup>
				<Button type="button" size="compact" variant="outline" disabled={!newModelId.trim()} onClick={addModelId}>
					Add
				</Button>
			</div>

			{modelIds.length > 0 ? (
				<p className="text-caption text-muted-foreground tabular-nums">
					{modelIds.length} model{modelIds.length === 1 ? "" : "s"}
					{normalizedFilter ? ` · ${filteredModelIds.length} matching search` : ""}
				</p>
			) : null}
			{showEmptyError ? <p className="text-caption text-destructive">At least one model id is required.</p> : null}
		</div>
	);
}
