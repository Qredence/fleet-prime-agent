import { createFileRoute } from "@tanstack/react-router"
import { ChatWorkspaceShell } from "@/lib/pi/chat-workspace-shell"

export const Route = createFileRoute("/")({ component: ChatWorkspaceShell })
