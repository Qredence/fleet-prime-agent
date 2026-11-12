import { Bot, Check, ChevronDown, FileCode2, ListTodo, Settings2, X } from "lucide-react";
import { type ComponentType, memo, useCallback, useEffect, useState } from "react";
import type { InputBarProps } from "@/components/chat/composer/input-bar";
import { FileAttachment } from "@/components/chat/file-attachment";
import { Button } from "@/components/ui/button";
import { COMPOSER_SELECTOR_TRIGGER_CLASS, HIT_AREA_EXPAND_CLASS } from "@/components/layout/tokens";
import { InputGroupButton } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Radio, RadioGroup, RadioIndicator } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export const AGENT_CHAT_MODES = [
	{ id: "agent", label: "Agent", icon: Bot, description: "Default coding agent" },
	{ id: "plan", label: "Plan", icon: ListTodo, description: "Plan before executing" },
	{ id: "harness", label: "Harness", icon: Settings2, description: "Harness-aware turn" },
] as const;

export type ModeOption = {
	id: string;
	label: string;
	icon?: ComponentType<{ className?: string }>;
	description?: string;
};

export type ModeSelectorProps = {
	modes: Array<ModeOption>;
	value?: string;
	defaultValue?: string;
	onChange?: (modeId: string) => void;
	className?: string;
};

/**
 * Chat-mode picker.
 *
 * Keyboard selection, roving focus, and `role="radio"`/`aria-checked` come from
 * Base UI's radio group; the trigger's popup relationship comes from the
 * popover. Only the layout and labels live here.
 */
export const ModeSelector = memo(function ModeSelector({
	modes,
	value,
	defaultValue,
	onChange,
	className,
}: ModeSelectorProps) {
	const isControlled = value !== undefined;
	const [internalValue, setInternalValue] = useState(defaultValue);
	const activeId = isControlled ? value : internalValue;
	const activeMode = modes.find((mode) => mode.id === activeId) ?? modes[0];
	const [open, setOpen] = useState(false);

	/**
	 * Selection and dismissal are separate events. Arrow keys change the mode and
	 * leave the group open so the list can be walked, which is what a radio group
	 * is for; a pointer press commits and closes.
	 */
	const commitMode = useCallback(
		(id: string) => {
			if (!isControlled) setInternalValue(id);
			onChange?.(id);
		},
		[isControlled, onChange],
	);

	if (modes.length === 0) return null;
	const ActiveIcon = activeMode?.icon;
	const hasMultiple = modes.length > 1;
	const modeLabel = activeMode?.label ?? "";

	return (
		<Popover open={hasMultiple ? open : false} onOpenChange={hasMultiple ? setOpen : undefined}>
			<PopoverTrigger
				render={
					<InputGroupButton
						variant="ghost"
						size="sm"
						aria-label={modeLabel ? `Select mode, ${modeLabel}` : "Select mode"}
						title={modeLabel}
						disabled={!hasMultiple}
						tabIndex={hasMultiple ? undefined : -1}
						className={cn(COMPOSER_SELECTOR_TRIGGER_CLASS, className)}
					>
						{ActiveIcon ? <ActiveIcon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
						<span className="min-w-0 truncate font-medium">{modeLabel}</span>
						{hasMultiple ? (
							<ChevronDown aria-hidden="true" className="size-3 shrink-0 text-foreground/70" />
						) : null}
					</InputGroupButton>
				}
			/>
			<PopoverContent side="top" align="start" sideOffset={6} className="w-56">
				{/*
				 * Only a pointer press closes the group. Arrow keys move the selection
				 * and must keep the list open so it can be walked, and Base UI's radio
				 * dispatches its own click when focus moves onto it — that click stops
				 * inside the hidden input, so it never reaches this handler.
				 */}
				<RadioGroup
					aria-label="Select mode"
					value={activeMode?.id ?? null}
					onValueChange={(next) => {
						if (typeof next === "string") commitMode(next);
					}}
					onClick={() => setOpen(false)}
				>
					{modes.map((mode) => {
						const Icon = mode.icon;
						return (
							<Radio key={mode.id} value={mode.id}>
								{Icon ? (
									<span aria-hidden="true" className="mt-0.5 shrink-0">
										<Icon className="size-3.5" />
									</span>
								) : null}
								<span className="min-w-0 flex-1">
									<span className="block truncate font-medium">{mode.label}</span>
									{mode.description ? (
										<span className="block truncate text-foreground/70">{mode.description}</span>
									) : null}
								</span>
								<RadioIndicator className="mt-0.5">
									<Check aria-hidden="true" className="size-3.5" />
								</RadioIndicator>
							</Radio>
						);
					})}
				</RadioGroup>
			</PopoverContent>
		</Popover>
	);
});

const LOADER_DOTS = ["·", "•", "●", "•"];

function ComposerLoaderActive({ label, className }: { label: string; className?: string }) {
	const [elapsed, setElapsed] = useState(0);
	const [tick, setTick] = useState(0);

	useEffect(() => {
		const startedAt = Date.now();
		const interval = window.setInterval(() => {
			setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
			setTick((current) => current + 1);
		}, 500);
		return () => window.clearInterval(interval);
	}, []);

	return (
		<div className={cn("flex items-center gap-2 px-chat-context py-1 text-xs text-foreground/70", className)}>
			<span aria-hidden="true" className="font-mono text-primary">
				{LOADER_DOTS[tick % LOADER_DOTS.length]}
			</span>
			<span className="sr-only" aria-live="polite">
				{label}
			</span>
			<span aria-hidden="true" className="truncate">
				{label}
			</span>
			<span aria-hidden="true" className="tabular-nums text-foreground/50">
				{elapsed}s
			</span>
		</div>
	);
}

/**
 * Mirrors the TUI's working-loader: a tiny animated indicator, the current
 * activity verb (Working / Waiting / Thinking / Writing / Executing), and
 * elapsed seconds since the current turn started. The TUI also surfaces
 * token counts; the web port shows them when they arrive via the info
 * description (see InputBar `infoDescription`).
 */
export function ComposerLoader({
	label,
	isActive,
	className,
}: {
	label?: string;
	isActive: boolean;
	className?: string;
}) {
	if (!isActive || !label) return null;

	return <ComposerLoaderActive label={label} className={className} />;
}

/** Pending uploads and workspace references keep their existing placement. */
export function ComposerAttachments({
	attachments,
	workspaceReferences = [],
	onRemoveWorkspaceReference,
}: Pick<InputBarProps, "attachments" | "workspaceReferences" | "onRemoveWorkspaceReference">) {
	const images = attachments?.images ?? [];
	const files = attachments?.files ?? [];
	return (
		<>
			{images.length > 0 || files.length > 0 ? (
				<div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 p-2">
					{images.map((image) => (
						<FileAttachment
							key={image.id}
							id={image.id}
							filename={image.filename}
							size={image.size}
							isImage
							url={image.url}
							onRemove={attachments?.onRemoveImage ? () => attachments.onRemoveImage?.(image.id) : undefined}
						/>
					))}
					{files.map((file) => (
						<FileAttachment
							key={file.id}
							id={file.id}
							filename={file.filename}
							size={file.size}
							onRemove={attachments?.onRemoveFile ? () => attachments.onRemoveFile?.(file.id) : undefined}
						/>
					))}
				</div>
			) : null}
			{workspaceReferences.length > 0 ? (
				<div className="flex flex-wrap gap-1.5 rounded-xl border bg-muted/40 p-2">
					{workspaceReferences.map((attachment) => (
						<div
							key={attachment.relativePath}
							className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-background px-2 py-1 text-xs text-foreground/75"
						>
							<FileCode2 aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
							<span className="max-w-[min(28rem,70vw)] truncate" title={`@${attachment.relativePath}`}>
								@{attachment.relativePath}
							</span>
							<Button
								variant="ghost"
								size="icon-compact"
								type="button"
								aria-label={`Remove workspace reference ${attachment.relativePath}`}
								onClick={() => onRemoveWorkspaceReference?.(attachment.relativePath)}
								className={cn(
									HIT_AREA_EXPAND_CLASS,
									"grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
								)}
							>
								<X aria-hidden="true" className="size-3" />
							</Button>
						</div>
					))}
				</div>
			) : null}
		</>
	);
}
