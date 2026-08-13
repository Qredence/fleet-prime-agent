// Motion tokens. Each tier has an ENTER spring (critically damped) and a
// matching EXIT tween (no bounce, one tier quicker). Keep enter/exit as
// siblings so spreading enter into Motion `transition` never pollutes with exit.
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
