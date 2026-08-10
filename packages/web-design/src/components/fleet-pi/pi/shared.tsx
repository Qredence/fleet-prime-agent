import {
  BookOpen,
  ClipboardList,
  FileText,
  Package,
  Palette,
  Plug,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type {
  ChatResourceInfo,
  ChatResourcesResponse,
  WorkspaceTreeNode,
  WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol"

export type ResourceGroupId =
  "skills" | "prompts" | "extensions" | "packages" | "themes" | "agentsFiles"

export function getResourceGroups(
  resources: ChatResourcesResponse | null,
  workspace: WorkspaceTreeResponse | null
): Array<{
  id: ResourceGroupId
  label: string
  icon: LucideIcon
  items: Array<ChatResourceInfo>
}> {
  return [
    {
      id: "skills",
      label: "Skills",
      icon: BookOpen,
      items: mergeResourceItems(
        resources?.skills.filter((skill) => skill.installedInWorkspace) ?? [],
        getWorkspaceSkillResources(workspace)
      ),
    },
    {
      id: "prompts",
      label: "Prompts",
      icon: FileText,
      items: resources?.prompts ?? [],
    },
    {
      id: "extensions",
      label: "Extensions",
      icon: Plug,
      items: resources?.extensions ?? [],
    },
    {
      id: "packages",
      label: "Packages",
      icon: Package,
      items: resources?.packages ?? [],
    },
    {
      id: "themes",
      label: "Themes",
      icon: Palette,
      items: resources?.themes ?? [],
    },
    {
      id: "agentsFiles",
      label: "Context",
      icon: ClipboardList,
      items: resources?.agentsFiles ?? [],
    },
  ]
}

export function countWorkspaceFiles(nodes: Array<WorkspaceTreeNode>): number {
  return nodes.reduce((count, node) => {
    if (node.type === "file") return count + 1
    if (!node.children?.length) return count
    return count + countWorkspaceFiles(node.children)
  }, 0)
}

export function findWorkspaceNode(
  nodes: Array<WorkspaceTreeNode>,
  path: string
): WorkspaceTreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    const child = node.children ? findWorkspaceNode(node.children, path) : null
    if (child) return child
  }

  return null
}

export function getWorkspaceSkillResources(
  workspace: WorkspaceTreeResponse | null
): Array<ChatResourceInfo> {
  if (!workspace) return []

  const skillsRoot = findWorkspaceNode(
    workspace.nodes,
    "agent-workspace/skills"
  )
  if (!skillsRoot?.children?.length) return []

  return skillsRoot.children
    .filter((node) => node.type === "directory")
    .flatMap((node) => {
      const skillFile =
        node.children?.find(
          (child) =>
            child.type === "file" && child.name.toLowerCase() === "skill.md"
        ) ?? null

      if (!skillFile) return []

      return [
        {
          name: node.name,
          path: skillFile.path,
          source: "workspace",
        },
      ]
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function displayResourcePath(path: string) {
  const marker = "/fleet-pi/"
  const index = path.indexOf(marker)
  return index >= 0 ? path.slice(index + marker.length) : path
}

export function getResourceChipTitle(item: ChatResourceInfo) {
  return [
    item.name,
    item.source ? `Source: ${item.source}` : null,
    item.activationStatus ? `Status: ${item.activationStatus}` : null,
    item.description ?? null,
    item.workspacePath ? displayResourcePath(item.workspacePath) : null,
    item.path ? displayResourcePath(item.path) : null,
  ]
    .filter(Boolean)
    .join("\n")
}

export function resourceKey(item: ChatResourceInfo) {
  return `${item.source ?? "resource"}:${item.path ?? item.name}`
}

export function ResourceNotice({
  description,
  icon: Icon,
  title,
}: {
  description: string
  icon: LucideIcon
  title: string
}) {
  return (
    <div className="my-1.5 rounded-sm bg-foreground/5 px-2.5 py-2">
      <div className="flex items-center gap-2 text-label font-medium text-foreground/65">
        <Icon className="size-3.5" />
        <span>{title}</span>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-foreground/40">
        {description}
      </p>
    </div>
  )
}

export function ResourceChipSection({
  id,
  icon: Icon,
  items,
  label,
}: {
  id: string
  icon: LucideIcon
  items: Array<ChatResourceInfo>
  label: string
}) {
  return (
    <section
      id={`resource-section-${id}`}
      className="flex min-w-0 flex-col gap-2 py-2.5"
      aria-label={`${label} resources`}
    >
      <div className="flex min-w-0 items-center text-body leading-5 text-foreground/45">
        <span className="truncate underline decoration-foreground/25 underline-offset-2">
          {label}
        </span>
        <span className="ml-1 shrink-0 text-[11px] leading-4 text-foreground/30 tabular-nums no-underline">
          {items.length}
        </span>
      </div>
      <div
        className="flex min-w-0 flex-col items-stretch gap-1.5"
        role="list"
        data-testid={`resource-chip-section-${label.toLowerCase()}`}
      >
        {items.length === 0 ? (
          <span className="inline-flex h-7.5 items-center rounded-lg border border-border/60 bg-background px-3 text-body leading-5 text-foreground/35 shadow-[0_1px_4px_-1px_rgba(0,0,0,0.06)]">
            Empty
          </span>
        ) : (
          items.map((item) => (
            <ResourceChip
              key={resourceKey(item)}
              icon={Icon}
              item={item}
              stacked
            />
          ))
        )}
      </div>
    </section>
  )
}

function ResourceChip({
  icon,
  item,
  stacked = false,
}: {
  icon: LucideIcon
  item: ChatResourceInfo
  stacked?: boolean
}) {
  const title = getResourceChipTitle(item)

  return (
    <div
      role="listitem"
      className={`max-w-full rounded-lg border border-border/70 bg-background px-2.5 text-body leading-5 text-foreground/80 shadow-[0_1px_4px_-1px_rgba(0,0,0,0.06)] ${
        stacked
          ? "flex min-h-9 w-full min-w-0 items-center gap-2 py-1.5"
          : "inline-flex h-7.5 items-center gap-1"
      }`}
      aria-label={title}
      data-testid="resource-chip"
      title={title}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <ResourceChipIcon icon={icon} />
        <span className="min-w-0 truncate">{item.name}</span>
      </div>
      {item.source && (
        <span className="max-w-20 shrink-0 truncate rounded-[5px] bg-foreground/5 px-1.5 py-0.5 text-[10px] leading-3 text-foreground/35">
          {item.source}
        </span>
      )}
      {item.activationStatus && (
        <span className="max-w-24 shrink-0 truncate rounded-[5px] bg-foreground/5 px-1.5 py-0.5 text-[10px] leading-3 text-foreground/35">
          {item.activationStatus}
        </span>
      )}
    </div>
  )
}

function ResourceChipIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/4 text-foreground/45">
      <Icon className="size-3.5" />
    </span>
  )
}

function mergeResourceItems(
  primary: Array<ChatResourceInfo>,
  secondary: Array<ChatResourceInfo>
) {
  const seen = new Set<string>()
  return [...primary, ...secondary].filter((item) => {
    const key = `${item.path ?? item.workspacePath ?? ""}:${item.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
