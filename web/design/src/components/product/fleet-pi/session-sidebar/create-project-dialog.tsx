import { ArrowUp, FolderOpen, FolderPlus, FolderTree, TriangleAlert } from "lucide-react";
import { useId } from "react";
import { Button } from "../../../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../ui/dialog";
import { Input } from "../../../ui/input";
import { Spinner } from "../../../ui/spinner";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxGroup,
	ComboboxInput,
	ComboboxItem,
	ComboboxLabel,
	ComboboxList,
	ComboboxTrigger,
} from "../../../registry/beui/motion/combobox";
import type { SidebarStateView } from "./state";
import type { FleetSessionSidebarDependencies } from "./types";
import { pathEntryLabel } from "./types";

type SidebarCreateDialogProps = {
	createOpen: SidebarStateView["createOpen"];
	setCreateOpen: SidebarStateView["setCreateOpen"];
	directoryBrowser: SidebarStateView["directoryBrowser"];
	setDirectoryBrowser: SidebarStateView["setDirectoryBrowser"];
	directoryBrowseLoading: SidebarStateView["directoryBrowseLoading"];
	directoryBrowseError: SidebarStateView["directoryBrowseError"];
	setDirectoryBrowseError: SidebarStateView["setDirectoryBrowseError"];
	onBrowseDirectories?: FleetSessionSidebarDependencies["onBrowseDirectories"];
	directoryToken: SidebarStateView["directoryToken"];
	setDirectoryToken: SidebarStateView["setDirectoryToken"];
	createName: SidebarStateView["createName"];
	setCreateName: SidebarStateView["setCreateName"];
	createPath: SidebarStateView["createPath"];
	setCreatePath: SidebarStateView["setCreatePath"];
	loadDirectories: (input: { path?: string; token?: string }) => Promise<boolean>;
	createSubmitting: SidebarStateView["createSubmitting"];
	createSubmitError: SidebarStateView["createSubmitError"];
	setCreateSubmitError: SidebarStateView["setCreateSubmitError"];
	submitCreate: () => Promise<void>;
};

export function FleetSessionSidebarCreateDialog({
	createOpen,
	setCreateOpen,
	directoryBrowser,
	setDirectoryBrowser,
	directoryBrowseLoading,
	directoryBrowseError,
	setDirectoryBrowseError,
	onBrowseDirectories,
	directoryToken,
	setDirectoryToken,
	createName,
	setCreateName,
	createPath,
	setCreatePath,
	loadDirectories,
	createSubmitting,
	createSubmitError,
	setCreateSubmitError,
	submitCreate,
}: SidebarCreateDialogProps) {
	const projectNameId = useId();
	const directoryId = useId();
	const directoryHelpId = useId();
	const selectedDirectoryPath = directoryBrowser?.pathLabel ?? createPath;
	const canSubmit = Boolean(directoryToken || createPath.trim().startsWith("/"));

	const resetDirectoryChoice = () => {
		setDirectoryBrowser(null);
		setDirectoryToken(undefined);
		setCreatePath("");
		setDirectoryBrowseError(null);
	};

	const closeDialog = () => {
		if (createSubmitting) return;
		resetDirectoryChoice();
		setCreateName("");
		setCreateSubmitError(null);
		setCreateOpen(false);
	};

	return (
		<Dialog
			open={createOpen}
			onOpenChange={(open) => {
				if (open) setCreateOpen(true);
				else closeDialog();
			}}
		>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Add project</DialogTitle>
					<DialogDescription>
						Choose the local directory that owns this project&apos;s sessions. Browse the server filesystem or paste
						an absolute path.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-1.5">
						<div className="flex items-center justify-between gap-2">
							<label className="text-sm font-medium" htmlFor={projectNameId}>
								Project name
							</label>
							<span className="text-xs text-muted-foreground">Optional</span>
						</div>
						<Input
							id={projectNameId}
							value={createName}
							onChange={(event) => setCreateName(event.target.value)}
							placeholder="e.g. Fleet Prime"
							aria-label="Project name"
						/>
					</div>

					<div className="space-y-1.5">
						<div className="flex items-center justify-between gap-2">
							<label className="text-sm font-medium" htmlFor={directoryId}>
								Local directory
							</label>
							<span className="text-xs text-muted-foreground">Required</span>
						</div>
						<Input
							id={directoryId}
							value={createPath}
							onChange={(event) => {
								setCreatePath(event.target.value);
								setDirectoryToken(undefined);
								setDirectoryBrowser(null);
								setDirectoryBrowseError(null);
								setCreateSubmitError(null);
							}}
							placeholder="/absolute/path/to/project"
							aria-label="Project directory"
							aria-describedby={directoryHelpId}
							spellCheck={false}
							autoCapitalize="off"
							autoCorrect="off"
							className="h-10 font-mono text-xs"
						/>
						<p id={directoryHelpId} className="text-xs text-muted-foreground">
							Browse to select a directory, or paste an absolute path. The server validates the final choice before
							registering it.
						</p>
					</div>

					{directoryBrowseLoading && !directoryBrowser ? (
						<div
							className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground"
							role="status"
							aria-live="polite"
						>
							<Spinner className="size-4" />
							Loading directories…
						</div>
					) : null}

					{directoryBrowser ? (
						<div className="overflow-hidden rounded-xl border bg-muted/20" data-testid="project-directory-browser">
							<div className="flex items-start gap-3 p-3">
								<div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
									<FolderOpen className="size-4" />
								</div>
								<div className="min-w-0 flex-1">
									<p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
										Selected directory
									</p>
									<p className="mt-1 break-all font-mono text-xs text-foreground" title={selectedDirectoryPath}>
										{selectedDirectoryPath}
									</p>
								</div>
								<span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
									Selected
								</span>
							</div>

							<div className="space-y-2 border-t px-3 py-3">
								<div className="flex items-center justify-between gap-2">
									<div>
										<p className="text-sm font-medium">Browse child directories</p>
										<p className="text-xs text-muted-foreground">Open a folder to make it the selected directory.</p>
									</div>
									{directoryBrowser.parentToken ? (
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={directoryBrowseLoading}
											onClick={() => void loadDirectories({ token: directoryBrowser.parentToken ?? undefined })}
											aria-label="Go up one directory"
											title="Go up one directory"
										>
											<ArrowUp className="size-3.5" />
											Up
										</Button>
									) : null}
								</div>

								{directoryBrowseLoading ? (
									<div
										className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground"
										role="status"
										aria-live="polite"
									>
										<Spinner className="size-4" />
										Loading directories…
									</div>
								) : directoryBrowser.entries.length === 0 ? (
									<p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
										No child directories here.
									</p>
								) : (
									<Combobox
										value={directoryToken}
										onValueChange={(token) => {
											const entry = directoryBrowser.entries.find(
												(candidate) => candidate.directoryToken === token,
											);
											if (!entry) return;
											void loadDirectories({ token });
										}}
									>
										<ComboboxTrigger className="h-10 bg-background">
											<ComboboxInput
												aria-label="Search child directories"
												placeholder="Choose a child directory…"
												className="text-xs"
											/>
										</ComboboxTrigger>
										<ComboboxContent className="w-[min(32rem,calc(100vw-3rem))]">
											<ComboboxList ariaLabel="Child directories">
												<ComboboxGroup>
													<ComboboxLabel>Child directories</ComboboxLabel>
													{directoryBrowser.entries.map((entry) => (
														<ComboboxItem
															key={entry.directoryToken}
															value={entry.directoryToken}
															textValue={`${entry.name} ${entry.pathLabel}`}
															keywords={[entry.pathLabel]}
														>
															<span className="flex min-w-0 items-start gap-2">
																<FolderTree className="mt-0.5 size-4 shrink-0" />
																<span className="min-w-0">
																	<span className="block truncate font-medium text-foreground">
																		{pathEntryLabel(entry)}
																	</span>
																	<span
																		className="block truncate text-[11px] text-muted-foreground"
																		title={entry.pathLabel}
																	>
																		{entry.pathLabel}
																	</span>
																</span>
															</span>
														</ComboboxItem>
													))}
												</ComboboxGroup>
												<ComboboxEmpty>No matching directories.</ComboboxEmpty>
											</ComboboxList>
										</ComboboxContent>
									</Combobox>
								)}
							</div>
						</div>
					) : onBrowseDirectories ? (
						<Button
							type="button"
							variant="outline"
							disabled={directoryBrowseLoading}
							onClick={() => void loadDirectories({})}
							className="w-full justify-start"
						>
							<FolderOpen className="size-4" />
							Browse directories
						</Button>
					) : null}

					{directoryBrowseError ? (
						<div
							className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
							role="alert"
						>
							<TriangleAlert className="mt-0.5 size-4 shrink-0" />
							<div className="min-w-0 flex-1">
								<p>{directoryBrowseError}</p>
								<Button
									type="button"
									variant="link"
									size="xs"
									className="mt-1 h-auto p-0 text-destructive"
									onClick={() =>
										void loadDirectories(directoryBrowser ? { token: directoryBrowser.directoryToken } : {})
									}
								>
									Try again
								</Button>
							</div>
						</div>
					) : null}

					{createSubmitError ? (
						<p className="text-sm text-destructive" role="alert">
							{createSubmitError}
						</p>
					) : null}
				</div>
				<DialogFooter>
					<Button type="button" variant="outline" disabled={createSubmitting} onClick={closeDialog}>
						Cancel
					</Button>
					<Button type="button" disabled={!canSubmit || createSubmitting} onClick={() => void submitCreate()}>
						{createSubmitting ? (
							<>
								<Spinner className="size-3.5" />
								Adding project…
							</>
						) : (
							<>
								<FolderPlus className="size-3.5" />
								Add project
							</>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
