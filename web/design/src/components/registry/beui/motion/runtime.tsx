"use client";

import { domMax, LazyMotion } from "motion/react";
import type { ReactNode } from "react";

export function MotionRuntime({ children }: { children: ReactNode }) {
	return <LazyMotion features={domMax}>{children}</LazyMotion>;
}
