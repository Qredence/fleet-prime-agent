import { CircleAlert } from "lucide-react"
import {
  ResourceChipSection,
  ResourceNotice,
  getResourceGroups,
} from "./shared"
import { ResourcesSkeleton } from "./skeleton-loaders"
import type {
  ChatResourcesResponse,
  WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol"

export function ResourcesPanelContent({
  error,
  loading,
  resources,
  workspace,
}: {
  error?: Error | null
  loading: boolean
  resources: ChatResourcesResponse | null
  workspace: WorkspaceTreeResponse | null
}) {
  const groups = getResourceGroups(resources, workspace)

  return (
    <>
      {error && (
        <ResourceNotice
          icon={CircleAlert}
          title="Unable to load resources"
          description={error.message}
        />
      )}
      {!error && loading && !resources && <ResourcesSkeleton />}
      {!error &&
        resources &&
        groups.map((group) => (
          <ResourceChipSection key={group.id} {...group} />
        ))}
    </>
  )
}
