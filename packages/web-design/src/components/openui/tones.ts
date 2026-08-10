export const openUIToneSchema = ["default", "info", "success", "warning", "danger"] as const;

export type OpenUITone = (typeof openUIToneSchema)[number];

export const openUITextToneSchema = ["default", "muted", "success", "warning", "danger"] as const;

export type OpenUITextTone = (typeof openUITextToneSchema)[number];

/** Surface / card / callout border+fill tones using semantic status tokens. */
export const toneClasses: Record<OpenUITone, string> = {
	default: "border-border bg-card text-card-foreground",
	info: "border-info/30 bg-info/10 text-info-foreground",
	success: "border-success/30 bg-success/10 text-success-foreground",
	warning: "border-warning/30 bg-warning/10 text-warning-foreground",
	danger: "border-destructive/30 bg-destructive/10 text-destructive",
};

export const textToneClasses: Record<OpenUITextTone, string> = {
	default: "text-foreground",
	muted: "text-muted-foreground",
	success: "text-success-foreground",
	warning: "text-warning-foreground",
	danger: "text-destructive",
};

export const badgeVariantsByTone = {
	default: "secondary",
	info: "outline",
	success: "outline",
	warning: "outline",
	danger: "destructive",
} as const;

/** Extra classes when Badge variant alone cannot express status color. */
export const badgeToneClasses: Record<OpenUITone, string> = {
	default: "",
	info: "border-info/30 bg-info/10 text-info-foreground",
	success: "border-success/30 bg-success/10 text-success-foreground",
	warning: "border-warning/30 bg-warning/10 text-warning-foreground",
	danger: "",
};
