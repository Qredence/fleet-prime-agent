import { RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * Renders the revert and commit action buttons inside a settings pane header.
 */
export function SettingsCommitActions({
	saveDisabled = false,
	dirty,
	disabled,
	onRevert,
	onSave,
	saving,
}: {
	saveDisabled?: boolean;
	dirty: boolean;
	disabled: boolean;
	onRevert: () => void;
	onSave: () => void;
	saving: boolean;
}) {
	return (
		<>
			{dirty ? (
				<Button
					type="button"
					variant="ghost"
					size="icon-compact"
					className="text-muted-foreground transition-transform active:scale-[0.96]"
					disabled={disabled || saving}
					onClick={onRevert}
					aria-label="Cancel changes"
				>
					<RotateCcw />
				</Button>
			) : null}
			<Button
				type="button"
				variant="outline"
				size="compact"
				className={cn("transition-transform active:scale-[0.96]", dirty && "border-primary/30 text-primary")}
				disabled={!dirty || disabled || saving || saveDisabled}
				onClick={onSave}
			>
				{saving ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <Save data-icon="inline-start" />}
				Save changes
			</Button>
		</>
	);
}
