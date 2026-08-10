export const CHAT_PANEL_BREAKPOINT_PX = 960;
export const WORKSPACE_SPLIT_MIN_WIDTH_PX = 640;

export const CHAT_HEADER_OFFSET_PX = 12;
export const CHAT_HEADER_HEIGHT_PX = 36;
export const CHAT_MOBILE_PANEL_GAP_PX = 8;

export const CHAT_CHROME_TOP_PX = CHAT_HEADER_OFFSET_PX + CHAT_HEADER_HEIGHT_PX + CHAT_MOBILE_PANEL_GAP_PX;

export const RESOURCE_CANVAS_VIEWPORT_RATIO = 0.5;

/** Full Tailwind class strings — keep breakpoint px values in sync above. */
export const DESKTOP_PANEL_HIDDEN_FLEX = "hidden min-[960px]:flex";
export const DESKTOP_PANEL_ONLY = "min-[960px]:hidden";
export const WORKSPACE_SPLIT_HIDDEN_BLOCK = "hidden min-[640px]:block";
export const WORKSPACE_SPLIT_GAP_RESET = "min-[640px]:gap-0";
