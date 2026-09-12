"use client";

import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { type ReactNode, useLayoutEffect, useState } from "react";

function useHtmlReducedMotionClass() {
	const [reduced, setReduced] = useState(false);
	useLayoutEffect(() => {
		const root = document.documentElement;
		const sync = () => setReduced(root.classList.contains("reduce-motion"));
		sync();
		const observer = new MutationObserver(sync);
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);
	return reduced;
}

export function MotionRuntime({ children }: { children: ReactNode }) {
	const htmlReduced = useHtmlReducedMotionClass();
	return (
		<LazyMotion features={domAnimation} strict>
			<MotionConfig reducedMotion={htmlReduced ? "always" : "user"}>{children}</MotionConfig>
		</LazyMotion>
	);
}
