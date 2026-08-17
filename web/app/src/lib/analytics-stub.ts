// v1: no analytics. All imports of @/lib/analytics/posthog funnel through here.

export function initAnalytics(): void {}

export function identifyAnalyticsUser(_user: unknown): void {}

export function resetAnalytics(): void {}

export function captureChatSessionStarted(_input: {
	promptLength?: number;
	messageLength?: number;
	sessionId?: string;
	mode?: string;
	model?: string;
	hasImage?: boolean;
}): void {}

export function captureConversationSaved(_input: { sessionId?: string; messageCount?: number }): void {}
