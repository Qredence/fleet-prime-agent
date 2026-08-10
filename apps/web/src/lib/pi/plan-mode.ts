/**
 * plan-mode.ts — stubbed for v1.
 *
 * The fleet-pi source relies on a custom toolset/command-policy/questionnaire
 * runtime layered on top of pi's extension system. Prime-agent's own plan-mode
 * and harness-mode behavior differs (RLM-based refinement, /refine command,
 * autonomous budgets), so porting this file verbatim would silently misbehave.
 *
 * We keep the *types* that other files (chat-client, use-pi-chat) import, and
 * provide no-op implementations for the hooks the client consults. The server
 * side decides mode semantics when we actually wire the plan/harness commands
 * — see `web/server/` routes and `ARCHITECTURE.md`.
 */
import type { ChatMode, ChatPlanAction } from "@prime-agent/web-protocol/chat-protocol"

export * from "./plan-state"

const NORMAL_MODE_TOOLS_READONLY = ["grep", "find", "ls"] as const

export const CHAT_TOOL_ALLOWLIST: readonly string[] = NORMAL_MODE_TOOLS_READONLY

export function isSafeCommand(_command: string): boolean {
	// Without a policy engine on the server, all commands are permitted.
	// The agent loop itself is responsible for rejecting dangerous tool input.
	return true
}

export function getToolsForMode(
	_mode: ChatMode,
	planToolNames: readonly string[] = [],
): readonly string[] {
	return [...NORMAL_MODE_TOOLS_READONLY, ...planToolNames]
}

export function isPlanDecisionPending(_mode: ChatMode): boolean {
	return false
}

export function isPlanToolActive(_mode: ChatMode, _toolName: string): boolean {
	return false
}

export function getActiveModeContextType(
	_mode: ChatMode,
	_chatMode: ChatMode,
): string {
	return "agent"
}

export function setChatMode(_sessionId: string, _mode: ChatMode): void {
	// Server is the source of truth.
}

export function getChatMode(_sessionId: string): ChatMode {
	return "agent"
}

export function setPlanAction(_sessionId: string, _action: ChatPlanAction): void {
	// Server is the source of truth.
}

export function resolveQuestionnaireAnswer(
	_toolCallId: string | undefined,
	_answer: unknown,
): boolean {
	// Plan-questionnaire runtime dropped in v1 (see ARCHITECTURE.md). The
	// client still calls this for plan-decision answers; without a pending
	// entry we return false so the caller posts to /api/chat/question instead.
	return false
}
