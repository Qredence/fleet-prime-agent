"use client";

import { domMax, LazyMotion, MotionConfig } from "motion/react";
import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { IconProvider } from "@/lib/fluid/icon-context";
import { ShapeProvider, type ShapeVariant } from "@/lib/fluid/shape-context";
import { SizeProvider } from "@/lib/fluid/size-context";
import { useUiPreferences } from "@/lib/ui-preferences";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function useHtmlReducedMotionClass() {
	const [reduced, setReduced] = useState(false);
	useIsoLayoutEffect(() => {
		const root = document.documentElement;
		const sync = () => setReduced(root.classList.contains("reduce-motion"));
		sync();
		const observer = new MutationObserver(sync);
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);
	return reduced;
}

export function FluidRoot({
	children,
	defaultShape = "rounded",
}: {
	children: ReactNode;
	defaultShape?: ShapeVariant;
}) {
	const prefs = useUiPreferences();
	const htmlReduced = useHtmlReducedMotionClass();
	const reducedMotion = prefs.motion === "reduced" || htmlReduced ? "always" : "user";
	const size = prefs.density === "compact" ? "compact" : "default";

	return (
		<LazyMotion features={domMax} strict>
			<MotionConfig reducedMotion={reducedMotion}>
				<ShapeProvider defaultShape={defaultShape}>
					<SizeProvider size={size}>
						<IconProvider>{children}</IconProvider>
					</SizeProvider>
				</ShapeProvider>
			</MotionConfig>
		</LazyMotion>
	);
}
