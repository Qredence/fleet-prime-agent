import { WorkspacePanelContent } from "./workspace-panel"
import { getArtifactsScopePath } from "./artifacts-utils"
import type { WorkspacePanelContentProps } from "./workspace-panel"

export function ArtifactsPanelContent({
  error,
  loadWorkspaceFile,
  loading,
  onSelectedPathChange,
  selectedPath,
  workspace,
}: Pick<
  WorkspacePanelContentProps,
  | "error"
  | "loadWorkspaceFile"
  | "loading"
  | "onSelectedPathChange"
  | "selectedPath"
  | "workspace"
>) {
  const scopePath = workspace
    ? getArtifactsScopePath(workspace.root)
    : undefined

  return (
    <WorkspacePanelContent
      emptyDescription="No artifacts folder was found under agent-workspace yet."
      emptyTitle="Artifacts unavailable"
      error={error}
      loadWorkspaceFile={loadWorkspaceFile}
      loading={loading}
      onSelectedPathChange={onSelectedPathChange}
      previewEmptyDescription="Choose a report, dataset, trace, or diagram to preview."
      previewEmptyTitle="Select an artifact"
      scopeLabel="artifacts"
      scopePath={scopePath}
      selectedPath={selectedPath}
      treeTestId="artifacts-tree"
      workspace={workspace}
    />
  )
}
