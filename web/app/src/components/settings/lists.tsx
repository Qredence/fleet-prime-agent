import type { ChatResourceInfo } from "@prime-agent/web-protocol/chat-protocol";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Select } from "@/components/ui/select";
import {
	addUniqueSettingsResource,
	resourceOptionValue,
	settingsResourceListIncludes,
	toSettingsResourcePath,
} from "@/lib/settings/settings-resource-path";

/**
 * List editor that prefers Select when catalog entries exist (e.g. detected
 * agent-workspace skills). Existing values are always rows; free-text is
 * only for adding when no catalog options remain.
 */
export function CatalogValueList({
	addLabel,
	catalog,
	onChange,
	placeholder,
	values,
}: {
	addLabel: string;
	catalog: Array<ChatResourceInfo>;
	onChange: (values: Array<string>) => void;
	placeholder?: string;
	values: Array<string>;
}) {
	const [custom, setCustom] = useState("");

	const seenValues = new Set<string>();
	const options: Array<{ value: string; label: string }> = [];
	for (const item of catalog) {
		const value = resourceOptionValue(item);
		if (value.length === 0 || seenValues.has(value)) continue;
		seenValues.add(value);
		options.push({
			value,
			label: item.name || value,
		});
	}

	const labelByValue = new Map(options.map((option) => [option.value, option.label]));
	const catalogLabelFor = (value: string) =>
		labelByValue.get(value) ?? labelByValue.get(toSettingsResourcePath(value));
	const available = options.filter((option) => !settingsResourceListIncludes(values, option.value));

	const addCustom = () => {
		const trimmed = custom.trim();
		if (!trimmed) return;
		onChange(addUniqueSettingsResource(values, trimmed));
		setCustom("");
	};

	return (
		<div className="flex flex-col gap-1.5">
			{values.length === 0 ? (
				<p className="px-1 py-2 text-xs text-pretty text-muted-foreground">Nothing selected yet.</p>
			) : (
				values.map((value) => {
					const catalogLabel = catalogLabelFor(value);
					const subtitle = catalogLabel && catalogLabel !== value ? value : undefined;
					return (
						<Item
							key={value}
							variant="outline"
							size="sm"
							className="flex-nowrap gap-3 rounded-lg border-border/50 bg-muted/20 px-2.5 py-2"
						>
							<ItemContent className="min-w-0 gap-0.5">
								<ItemTitle className="w-full truncate text-sm font-medium text-foreground">
									{catalogLabel ?? value}
								</ItemTitle>
								{subtitle ? (
									<ItemDescription className="truncate text-xs text-muted-foreground">
										{subtitle}
									</ItemDescription>
								) : null}
							</ItemContent>
							<ItemActions className="shrink-0">
								<Button
									type="button"
									variant="ghost"
									size="icon-compact"
									aria-label={`Remove ${value}`}
									onClick={() => onChange(values.filter((entry) => entry !== value))}
								>
									<Trash2 />
								</Button>
							</ItemActions>
						</Item>
					);
				})
			)}

			{available.length > 0 ? (
				<Select
					aria-label={addLabel}
					value={null}
					placeholder={addLabel}
					options={available}
					onValueChange={(next) => {
						if (!next) return;
						onChange(addUniqueSettingsResource(values, next));
					}}
				/>
			) : (
				<InputGroup>
					<InputGroupInput
						aria-label={addLabel}
						value={custom}
						onChange={(event) => setCustom(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								addCustom();
							}
						}}
						placeholder={placeholder}
					/>
					<InputGroupAddon align="inline-end">
						<InputGroupButton onClick={addCustom} disabled={!custom.trim()}>
							<Plus data-icon="inline-start" />
							Add
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
			)}
		</div>
	);
}
