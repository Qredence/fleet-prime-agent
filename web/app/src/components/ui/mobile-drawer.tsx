"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { m } from "motion/react";
import {
	type CSSProperties,
	type HTMLAttributes,
	type ReactNode,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { omit } from "@/lib/fluid/omit";
import { exitFallbackMs, spring } from "@/lib/fluid/springs";
import { surfaceClasses } from "@/lib/fluid/surface-classes";
import { SurfaceProvider, useSurface } from "@/lib/fluid/surface-context";
import { cn } from "@/lib/utils";

type MobileDrawerSide = "left" | "right" | "bottom";

interface MobileDrawerProps {
	open: boolean;
	onClose: () => void;
	children: ReactNode;
	triggerRef?: RefObject<HTMLElement | null>;
	side?: MobileDrawerSide;
	modal?: boolean | "trap-focus";
	ariaLabel?: string;
	className?: string;
}

type MotionSafeDivProps = Omit<
	HTMLAttributes<HTMLDivElement>,
	"onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd" | "onAnimationIteration"
>;

type DialogChangeEventDetails = DialogPrimitive.Root.ChangeEventDetails;

function usePopupExit(open: boolean, setOpen: (open: boolean) => void, triggerRef?: RefObject<HTMLElement | null>) {
	const actionsRef = useRef<DialogPrimitive.Root.Actions | null>(null);
	const [rootOpen, setRootOpen] = useState(open);
	if (open && !rootOpen) setRootOpen(true);
	useLayoutEffect(() => {
		if (open || !rootOpen) return;
		if (actionsRef.current) actionsRef.current.close();
		else setRootOpen(false);
	}, [open, rootOpen]);
	const onOpenChange = (next: boolean, details: DialogChangeEventDetails) => {
		if (
			!next &&
			details.reason === "outside-press" &&
			details.event?.target instanceof Node &&
			triggerRef?.current?.contains(details.event.target)
		) {
			details.cancel();
			return;
		}
		if (details.isCanceled) return;
		if (!next) {
			details.preventUnmountOnClose();
			setRootOpen(false);
		}
		if (next !== open) setOpen(next);
	};
	return { actionsRef, rootOpen: open || rootOpen, onOpenChange };
}

const SIDE_LAYOUT: Record<MobileDrawerSide, string> = {
	left: "top-0 left-0 bottom-0 w-64",
	right: "top-0 right-0 bottom-0 w-64",
	bottom: "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl",
};

function sideTransform(side: MobileDrawerSide, open: boolean) {
	if (side === "bottom") return { y: open ? 0 : "100%" };
	const hiddenX = side === "left" ? "-100%" : "100%";
	return { x: open ? 0 : hiddenX };
}

export function MobileDrawer({
	open,
	onClose,
	children,
	triggerRef,
	side = "left",
	modal = true,
	ariaLabel = "Navigation",
	className,
}: MobileDrawerProps) {
	const substrate = useSurface();
	const level = Math.min(substrate + 2, 8);

	const { actionsRef, rootOpen, onOpenChange } = usePopupExit(
		open,
		(next) => {
			if (!next) onClose();
		},
		triggerRef,
	);

	useEffect(() => {
		if (open) return;
		const id = setTimeout(() => actionsRef.current?.unmount(), exitFallbackMs(spring.moderate));
		return () => clearTimeout(id);
	}, [open, actionsRef]);

	const closedTransform = sideTransform(side, false);
	const currentTransform = sideTransform(side, open);

	return (
		<DialogPrimitive.Root open={rootOpen} onOpenChange={onOpenChange} actionsRef={actionsRef} modal={modal}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Backdrop
					render={(backdropProps) => {
						const rest = omit(backdropProps as HTMLAttributes<HTMLDivElement>, [
							"style",
							"onDrag",
							"onDragStart",
							"onDragEnd",
							"onAnimationStart",
							"onAnimationEnd",
							"onAnimationIteration",
						]);
						return (
							<m.div
								{...(rest as MotionSafeDivProps)}
								data-slot="mobile-drawer-overlay"
								className="fixed inset-0 z-[var(--z-overlay,40)] bg-black/40 dark:bg-black/80"
								initial={{ opacity: 0 }}
								animate={{ opacity: open ? 1 : 0 }}
								transition={open ? { duration: 0.16 } : spring.moderate.exit}
							/>
						);
					}}
				/>

				<DialogPrimitive.Popup
					aria-label={ariaLabel}
					finalFocus={triggerRef}
					render={(popupProps) => {
						const { style: baseStyle, ...baseRest } = popupProps as HTMLAttributes<HTMLDivElement>;
						const rest = omit(baseRest, [
							"onDrag",
							"onDragStart",
							"onDragEnd",
							"onAnimationStart",
							"onAnimationEnd",
							"onAnimationIteration",
						]);
						return (
							<m.div
								{...(rest as MotionSafeDivProps)}
								data-slot="mobile-drawer-content"
								className={cn(
									"fixed z-[var(--z-modal,50)] overflow-y-auto p-4 focus:outline-none",
									SIDE_LAYOUT[side],
									surfaceClasses(level, 3),
									className,
								)}
								style={baseStyle as CSSProperties | undefined}
								initial={closedTransform}
								animate={currentTransform}
								transition={open ? spring.moderate : spring.moderate.exit}
								onAnimationComplete={() => {
									if (!open) actionsRef.current?.unmount();
								}}
							>
								<SurfaceProvider value={level}>{children}</SurfaceProvider>
							</m.div>
						);
					}}
				/>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

export default MobileDrawer;
export type { MobileDrawerProps, MobileDrawerSide };
