export const CHAT_PANEL_BREAKPOINT_PX = 960;
export const WORKSPACE_SPLIT_MIN_WIDTH_PX = 640;
/** App-shell chrome (session sidebar, settings nav) — matches Tailwind `md`. */
export const CHROME_MOBILE_BREAKPOINT_PX = 768;
export const CHROME_MOBILE_MAX_WIDTH_QUERY = `(max-width: ${CHROME_MOBILE_BREAKPOINT_PX - 1}px)`;

export const CHAT_HEADER_OFFSET_PX = 0;
export const CHAT_HEADER_HEIGHT_PX = 44;
export const CHAT_HEADER_COMPACT_HEIGHT_PX = 36;
export const CHAT_MOBILE_PANEL_GAP_PX = 8;

export const CHAT_CHROME_TOP_PX = CHAT_HEADER_OFFSET_PX + CHAT_HEADER_HEIGHT_PX + CHAT_MOBILE_PANEL_GAP_PX;

/**
 * Default open width for the desktop right panel (fraction of the viewport).
 * Replaces the former `RESOURCE_CANVAS_VIEWPORT_RATIO`, which incorrectly
 * doubled as both default open size and max-width cap.
 */
export const RESOURCE_CANVAS_DEFAULT_VIEWPORT_RATIO = 0.4;
/**
 * Expanded session sidebar width used when clamping the right panel.
 * Keep in sync with `ChatApp` `sidebarWidth="17.5rem"` in the chat shell.
 */
export const RESOURCE_CANVAS_SESSION_SIDEBAR_WIDTH_PX = 280;
/**
 * Minimum width reserved for the chat column when the user widens the right
 * panel. Combined with {@link RESOURCE_CANVAS_SESSION_SIDEBAR_WIDTH_PX} so the
 * panel max is measured against the full viewport, not the inset alone.
 */
export const RESOURCE_CANVAS_MAIN_CONTENT_MIN_WIDTH_PX = 360;

/** Full Tailwind class strings — keep breakpoint px values in sync above. */
export const DESKTOP_PANEL_HIDDEN_FLEX = "hidden min-[960px]:flex";
export const DESKTOP_PANEL_ONLY = "min-[960px]:hidden";
export const WORKSPACE_SPLIT_HIDDEN_BLOCK = "hidden min-[640px]:block";
export const WORKSPACE_SPLIT_GAP_RESET = "min-[640px]:gap-0";
