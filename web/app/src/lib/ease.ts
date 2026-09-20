export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

/** CSS string form of EASE_OUT for inline style transitions. */
export const EASE_OUT_CSS = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Press feedback on buttons and other tappable surfaces. */
export const SPRING_PRESS = {
	type: "spring",
	stiffness: 500,
	damping: 30,
	mass: 0.6,
} as const;

/** Content swaps — label/icon slots trading places inside a control. */
export const SPRING_SWAP = {
	type: "spring",
	stiffness: 460,
	damping: 30,
	mass: 0.55,
} as const;

/** Overlay panel entrances — modals and sheets summoned by pointer. */
export const SPRING_PANEL = {
	type: "spring",
	stiffness: 420,
	damping: 40,
	mass: 0.5,
} as const;

/** Shared-layout glides — pills, indicators and panels morphing between positions. */
export const SPRING_LAYOUT = {
	type: "spring",
	stiffness: 360,
	damping: 32,
	mass: 0.6,
} as const;

/** Cursor-follow physics for decorative mouse tracking (magnetic, tilt, dock). */
export const SPRING_MOUSE = {
	stiffness: 200,
	damping: 15,
	mass: 0.3,
} as const;

/** Dragged handles and fills (sliders) — critically damped `useSpring` config,
 * so the value follows the pointer butterily and never rebounds off an end. */
export const SPRING_GLIDE = {
	stiffness: 700,
	damping: 50,
	mass: 0.5,
} as const;

/** Tab / chrome indicator enter-exit tiers. Each ENTER spring is critically
 * damped; EXIT is a matching tween one tier quicker. */
export const spring = {
	fast: {
		enter: {
			type: "spring" as const,
			duration: 0.08,
			bounce: 0,
		},
		exit: { duration: 0.06 },
	},
	moderate: {
		enter: {
			type: "spring" as const,
			duration: 0.16,
			bounce: 0,
		},
		exit: { duration: 0.12 },
	},
	slow: {
		enter: {
			type: "spring" as const,
			duration: 0.24,
			bounce: 0.12,
		},
		exit: { duration: 0.16 },
	},
} as const;

export const fontWeights = {
	normal: "'wght' 400, 'opsz' 14",
	medium: "'wght' 450, 'opsz' 15",
	semibold: "'wght' 550, 'opsz' 20",
	bold: "'wght' 700, 'opsz' 25",
} as const;
