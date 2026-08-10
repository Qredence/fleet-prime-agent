// v1: no analytics. All imports of @/lib/analytics/posthog funnel through here.

export function isAnalyticsEnabled(): boolean {
	return false
}

export function initAnalytics(): void {}

export function trackEvent(_name: string, _properties?: Record<string, unknown>): void {}

export function identifyAnalyticsUser(_user: unknown): void {}

export function resetAnalytics(): void {}

export function captureChatSessionStarted(_input: {
	promptLength?: number
	messageLength?: number
	sessionId?: string
	sessionFile?: string
	cwd?: string
	mode?: string
	model?: string
	hasImage?: boolean
}): void {}

export function captureConversationSaved(_input: {
	sessionId?: string
	sessionFile?: string
	cwd?: string
	messageCount?: number
}): void {}

export const analytics = {
	capture: (_name: string, _properties?: Record<string, unknown>) => {},
	identify: (_id: string) => {},
}
