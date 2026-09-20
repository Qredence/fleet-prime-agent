import { createFileRoute } from "@tanstack/react-router";
import { ChatWorkspaceShell } from "@/components/layout/chat-workspace-shell";

export const Route = createFileRoute("/")({ component: ChatWorkspaceShell });
