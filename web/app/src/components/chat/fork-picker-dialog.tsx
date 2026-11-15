import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ForkPickerEntry = {
	id: string;
	preview: string;
};

export type ForkPickerDialogProps = {
	entries: Array<ForkPickerEntry> | null;
	onOpenChange: (open: boolean) => void;
	onPick: (entryId: string) => void;
};

export function ForkPickerDialog({ entries, onOpenChange, onPick }: ForkPickerDialogProps) {
	const open = entries !== null && entries.length > 0;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Fork from a message</DialogTitle>
					<DialogDescription>Creates a new session branched before the selected user message.</DialogDescription>
				</DialogHeader>
				<div className="flex max-h-[min(420px,60dvh)] flex-col gap-1 overflow-y-auto overscroll-contain">
					{(entries ?? []).map((entry) => (
						<Button
							key={entry.id}
							type="button"
							variant="ghost"
							size="compact"
							className="flex h-auto w-full flex-col items-start justify-start gap-0.5 rounded-md p-2 text-left text-sm leading-5 hover:bg-foreground/6"
							onClick={() => {
								onPick(entry.id);
								onOpenChange(false);
							}}
						>
							<span className="truncate font-medium">{entry.preview}</span>
							<span className="truncate font-mono text-xs text-foreground/40">{entry.id}</span>
						</Button>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
