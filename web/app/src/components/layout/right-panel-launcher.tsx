import type { ChatResourcesResponse, WorkspaceTreeResponse } from "@prime-agent/web-protocol/chat-protocol";
import type { LucideIcon } from "lucide-react";
import { PanelRight, X } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RightPanel } from "@/lib/layout/canvas-utils";
import { useChatPanelDataContext, useWorkspaceTreeContext } from "@/components/layout/right-panel-context";
import { RIGHT_PANEL_GROUPS } from "@/components/layout/right-panel-registry";
import { TabStrip } from "@/components/layout/tab-strip";
import { Button } from "@/components/ui/button";
import { MobileDrawer } from "@/components/ui/mobile-drawer";
import { Select, type SelectOption } from "@/components/ui/select";
import { getResourceGroups } from "@/lib/workspace/resource-helpers";
import { DESKTOP_PANEL_ONLY } from "@/lib/layout-constants";
import { cn } from "@/lib/utils";

/**
 * Renders responsive controls for opening or navigating the right panel based on context state.
 *
 * @param compact - Whether to use compact control styling
 */
export function RightPanelLauncherFromContext({ compact = false }: { compact?: boolean } = {}) {
	const { reopenRightPanel, rightPanel } = useChatPanelDataContext();

	return (
		<>
			<div className="flex min-w-0 justify-end min-[960px]:hidden">
				<RightPanelTabsFromContext compact={compact} idPrefix="right-panel-mobile" />
			</div>
			<div className="hidden min-[960px]:block">
				{rightPanel === null ? <RightPanelTrigger compact={compact} onOpen={reopenRightPanel} /> : null}
			</div>
		</>
	);
}

/**
 * Renders the right-panel launcher using application context state and data.
 *
 * @param compact - Whether to use compact launcher styling
 * @param idPrefix - Prefix used for generated right-panel element IDs
 * @returns The right-panel launcher
 */
export function RightPanelTabsFromContext({
	compact = false,
	idPrefix = "right-panel",
}: {
	compact?: boolean;
	idPrefix?: string;
}) {
	const { artifactRuns, transcriptSummary, rightPanel, setRightPanel, resources } = useChatPanelDataContext();
	const { workspaceTree } = useWorkspaceTreeContext();

	return (
		<RightPanelLauncher
			activePanel={rightPanel}
			onPanelChange={setRightPanel}
			resources={resources}
			sessionBlocks={transcriptSummary.openUIBlocks.length}
			openUIArtifacts={
				artifactRuns.flatMap((run) => run.artifacts).filter((artifact) => artifact.kind === "openui-html").length
			}
			workspace={workspaceTree}
			idPrefix={idPrefix}
			compact={compact}
		/>
	);
}

/**
 * Renders a button that opens the right-side panel.
 *
 * @param compact - Whether to use compact button styling
 * @param onOpen - Called when the button is clicked
 */
export function RightPanelTrigger({ compact = false, onOpen }: { compact?: boolean; onOpen: () => void }) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="compact"
			aria-label="Open side panel"
			title="Open side panel"
			className={cn(
				"relative inline-flex items-center justify-center rounded-md border border-border/70 bg-sidebar text-foreground/55 shadow-sm backdrop-blur transition-colors hover:bg-background hover:text-foreground/75",
				compact ? "!size-7 !rounded-[7px] !px-0" : "size-9 px-0",
			)}
			onClick={onOpen}
		>
			<PanelRight className="size-4" />
		</Button>
	);
}

/**
 * Renders responsive controls for opening, switching between, and closing right-panel views.
 *
 * @param activePanel - The active panel, or `null` when no panel is open
 * @param onPanelChange - Called with the selected panel, or `null` to close the active panel
 * @param resources - Resource data used for the resources badge
 * @param sessionBlocks - Number of generative UI blocks in the current session
 * @param openUIArtifacts - Number of open generative UI artifacts
 * @param workspace - Workspace data used for the resources badge
 * @param idPrefix - Prefix for the launcher's element IDs
 * @param compact - Whether to use compact launcher styling
 */
export function RightPanelLauncher({
	activePanel,
	onPanelChange,
	resources,
	sessionBlocks = 0,
	openUIArtifacts = 0,
	workspace,
	idPrefix = "right-panel",
	compact = false,
}: {
	activePanel: RightPanel;
	compact?: boolean;
	idPrefix?: string;
	onPanelChange: (panel: RightPanel) => void;
	resources: ChatResourcesResponse | null;
	/** Generative-UI blocks in the current session. */
	sessionBlocks?: number;
	openUIArtifacts?: number;
	workspace: WorkspaceTreeResponse | null;
}) {
	const totalResources = getResourceGroups(resources, workspace).reduce(
		(count, group) => count + group.items.length,
		0,
	);
	const totalArtifacts = useMemo(() => {
		const total = sessionBlocks + openUIArtifacts;
		return total > 0 ? total : undefined;
	}, [openUIArtifacts, sessionBlocks]);

	const tabs = useMemo(
		() =>
			RIGHT_PANEL_GROUPS.map((definition) => ({
				...definition,
				badge:
					definition.id === "artifacts"
						? totalArtifacts
						: definition.id === "session"
							? totalResources || undefined
							: undefined,
			})),
		[totalArtifacts, totalResources],
	);

	const activeGroup = tabs.find((tab) => activePanel !== null && tab.panels.includes(activePanel));
	const selectedIndex = activeGroup ? tabs.indexOf(activeGroup) : -1;
	const panelOptions = useMemo<Array<SelectOption>>(
		() =>
			tabs.map((tab) => ({
				value: tab.id,
				label: tab.title,
				icon: tab.icon as LucideIcon,
			})),
		[tabs],
	);

	return (
		<ResponsivePanelLauncher
			data-testid="right-panel-inline-launcher"
			data-active-panel={activePanel ?? "closed"}
			activePanel={activeGroup?.id ?? null}
			options={panelOptions}
			panelOptions={tabs}
			idPrefix={idPrefix}
			selectedIndex={selectedIndex}
			onSelect={(index) => {
				const next = tabs.at(index);
				if (!next) return;
				if (activeGroup?.id === next.id) return;
				onPanelChange(next.defaultPanel);
			}}
			compact={compact}
		/>
	);
}

type PanelLauncherTab = (typeof RIGHT_PANEL_GROUPS)[number] & {
	badge?: number;
};

type ResponsivePanelLauncherProps = Omit<HTMLAttributes<HTMLDivElement>, "className" | "onSelect"> & {
	activePanel: string | null;
	className?: string;
	compact?: boolean;
	idPrefix: string;
	onSelect: (index: number) => void;
	options: Array<SelectOption>;
	panelOptions: Array<PanelLauncherTab>;
	selectedIndex: number;
};

/**
 * Renders panel navigation as tabs or a dropdown based on the available width.
 *
 * @returns The responsive panel launcher.
 */
function ResponsivePanelLauncher({
	activePanel,
	className,
	compact = false,
	idPrefix,
	onSelect,
	options,
	panelOptions,
	selectedIndex,
	...props
}: ResponsivePanelLauncherProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const measurementRef = useRef<HTMLDivElement>(null);
	const [isDropdown, setIsDropdown] = useState(false);

	const measure = useCallback(() => {
		const container = containerRef.current;
		const measurement = measurementRef.current;
		if (!container || !measurement) return;

		const parentWidth = container.parentElement?.clientWidth ?? 0;
		const availableWidth = parentWidth > 0 ? parentWidth : container.clientWidth;
		if (availableWidth <= 0) return;

		const inner = measurement.firstElementChild;
		const requiredWidth = Math.max(
			measurement.scrollWidth,
			inner instanceof HTMLElement ? inner.scrollWidth : 0,
			measurement.getBoundingClientRect().width,
			inner instanceof HTMLElement ? inner.getBoundingClientRect().width : 0,
		);
		if (requiredWidth <= 0) return;

		setIsDropdown(requiredWidth > availableWidth + 1);
	}, []);

	useLayoutEffect(() => {
		measure();
		const container = containerRef.current;
		const measurement = measurementRef.current;
		if (!container || !measurement || typeof ResizeObserver === "undefined") return;

		const observer = new ResizeObserver(measure);
		if (container.parentElement) observer.observe(container.parentElement);
		observer.observe(container);
		observer.observe(measurement);
		return () => observer.disconnect();
	}, [measure, panelOptions, selectedIndex]);

	const selectPanel = useCallback(
		(nextPanel: string) => {
			const nextIndex = panelOptions.findIndex((panel) => panel.id === nextPanel);
			if (nextIndex >= 0) onSelect(nextIndex);
		},
		[onSelect, panelOptions],
	);
	const panelTabs = useMemo(
		() =>
			panelOptions.map((panel) => ({
				id: panel.id,
				label: panel.title,
				icon: panel.icon,
				badge: panel.badge,
				ariaLabel: panel.ariaLabel,
			})),
		[panelOptions],
	);

	return (
		<div
			ref={containerRef}
			className={`relative ${isDropdown ? "w-full" : "w-fit"} min-w-0 max-w-full overflow-hidden ${className ?? ""}`}
			data-panel-launcher-mode={isDropdown ? "dropdown" : "tabs"}
			{...props}
		>
			{isDropdown ? (
				<Select
					aria-label="Select panel"
					className={`w-full min-w-0 max-w-full rounded-full border-border/70 bg-sidebar ${compact ? "h-7" : ""}`}
					onValueChange={selectPanel}
					options={options}
					placeholder="Open panel"
					value={activePanel}
				/>
			) : (
				<TabStrip
					ariaLabel="Panel views"
					className="w-fit max-w-full"
					dataTestid={`${idPrefix}-tabs`}
					density="compact"
					onValueChange={selectPanel}
					tabs={panelTabs}
					value={activePanel}
					width="fit"
				/>
			)}
			<div
				ref={measurementRef}
				aria-hidden="true"
				className="pointer-events-none invisible absolute top-0 left-0 -z-10 w-max max-w-none"
				data-panel-launcher-measurement
				inert
			>
				<TabStrip
					ariaLabel="Panel views"
					className="w-max max-w-none"
					density="compact"
					onValueChange={() => undefined}
					tabs={panelTabs}
					value={activePanel}
					width="fit"
				/>
			</div>
		</div>
	);
}

export function MobilePanel({
	bodyClassName,
	children,
	dataTestid,
	headerActions,
	icon: Icon,
	onClose,
	open,
	title,
}: {
	bodyClassName?: string;
	children: ReactNode;
	dataTestid?: string;
	headerActions?: ReactNode;
	icon?: React.ElementType;
	onClose?: () => void;
	open: boolean;
	title?: string;
}) {
	return (
		<MobileDrawer
			open={open}
			onClose={() => onClose?.()}
			side="right"
			modal={false}
			ariaLabel={title ?? "Panel"}
			className={cn(
				"top-[var(--chat-chrome-top,52px)] right-[max(0.75rem,env(safe-area-inset-right))] bottom-auto left-auto h-[calc(100dvh-var(--chat-chrome-top,52px)-max(0.75rem,env(safe-area-inset-bottom)))] min-h-0 w-[min(360px,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-border/70 p-0 shadow-lg backdrop-blur",
				DESKTOP_PANEL_ONLY,
			)}
		>
			<div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-testid={dataTestid}>
				{title && (
					<div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-[var(--density-pad-x)]">
						<div className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground/80">
							{Icon && <Icon className="size-3.5 shrink-0" />}
							<span className="truncate">{title}</span>
						</div>
						<div className="flex shrink-0 items-center gap-1">
							{headerActions}
							{onClose && (
								<Button
									type="button"
									onClick={onClose}
									variant="ghost"
									size="icon-compact"
									className="hit-area-expand text-foreground/40 hover:text-foreground/70"
									aria-label="Close panel"
									title="Close panel"
								>
									<X data-icon="inline-start" className="size-3.5" />
								</Button>
							)}
						</div>
					</div>
				)}
				<div
					className={cn(
						"min-h-0 flex-1 overscroll-contain px-[var(--density-pad-x)] py-4",
						bodyClassName ?? "overflow-y-auto",
					)}
				>
					{children}
				</div>
			</div>
		</MobileDrawer>
	);
}
