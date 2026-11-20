export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

/** Content swaps — label/icon slots trading places inside a control. */
export const SPRING_SWAP = {
	type: "spring",
	stiffness: 460,
	damping: 30,
	mass: 0.55,
} as const;

/** Shared-layout glides — pills, indicators and panels morphing between positions. */
export const SPRING_LAYOUT = {
	type: "spring",
	stiffness: 360,
	damping: 32,
	mass: 0.6,
} as const;
