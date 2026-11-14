"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { m } from "motion/react";
import {
	type ButtonHTMLAttributes,
	createContext,
	forwardRef,
	type HTMLAttributes,
	isValidElement,
	type ReactElement,
	type ReactNode,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { fontWeights } from "@/lib/fluid/font-weight";
import { useIcons } from "@/lib/fluid/icon-context";
import { omit } from "@/lib/fluid/omit";
import { useShape } from "@/lib/fluid/shape-context";
import { useSize, useSizeVariant, typeClass } from "@/lib/fluid/size-context";
import { exitFallbackMs, spring } from "@/lib/fluid/springs";
import { surfaceClasses } from "@/lib/fluid/surface-classes";
import { SurfaceProvider, useSurface } from "@/lib/fluid/surface-context";
import { cn } from "@/lib/utils";

const DIALOG_OFFSET = 4;

type DialogChangeEventDetails = DialogPrimitive.Root.ChangeEventDetails;

interface DialogProps {
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean, eventDetails: DialogChangeEventDetails) => void;
	modal?: boolean;
	children?: ReactNode;
}

type DialogActions = DialogPrimitive.Root.Actions;

function usePopupExit(open: boolean, setOpen: (open: boolean, eventDetails: DialogChangeEventDetails) => void) {
	const actionsRef = useRef<DialogActions | null>(null);
	const [rootOpen, setRootOpen] = useState(open);
	if (open && !rootOpen) setRootOpen(true);
	useLayoutEffect(() => {
		if (open || !rootOpen) return;
		if (actionsRef.current) actionsRef.current.close();
		else setRootOpen(false);
	}, [open, rootOpen]);
	const onOpenChange = (next: boolean, details: DialogChangeEventDetails) => {
		if (next !== open) setOpen(next, details);
		if (details.isCanceled) return;
		if (!next) {
			details.preventUnmountOnClose();
			setRootOpen(false);
		}
	};
	return { actionsRef, rootOpen: open || rootOpen, onOpenChange };
}

const DialogExitContext = createContext<{
	open: boolean;
	actionsRef: React.RefObject<DialogActions | null>;
} | null>(null);

function Dialog({ children, open: openProp, defaultOpen = false, onOpenChange, modal }: DialogProps) {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
	const open = openProp ?? uncontrolledOpen;
	const setOpen = (next: boolean, details: DialogChangeEventDetails) => {
		onOpenChange?.(next, details);
		if (details.isCanceled) return;
		if (openProp === undefined) setUncontrolledOpen(next);
	};
	const { actionsRef, rootOpen, onOpenChange: handleOpenChange } = usePopupExit(open, setOpen);
	const exit = useMemo(() => ({ open, actionsRef }), [open, actionsRef]);

	return (
		<DialogExitContext.Provider value={exit}>
			<DialogPrimitive.Root open={rootOpen} onOpenChange={handleOpenChange} actionsRef={actionsRef} modal={modal}>
				{children}
			</DialogPrimitive.Root>
		</DialogExitContext.Provider>
	);
}

interface DialogSlotProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	/** Element to render as the control, e.g. a Button. */
	render?: ReactElement;
	/** Compose onto the single child element instead. */
	asChild?: boolean;
}

function slotRender(render: ReactElement | undefined, asChild: boolean | undefined, children: ReactNode) {
	if (render) return render;
	return asChild && isValidElement(children) ? children : undefined;
}

const DialogTrigger = forwardRef<HTMLButtonElement, DialogSlotProps>(({ render, asChild, children, ...props }, ref) => {
	const el = slotRender(render, asChild, children);
	return el ? (
		<DialogPrimitive.Trigger ref={ref} data-slot="dialog-trigger" render={el} {...props} />
	) : (
		<DialogPrimitive.Trigger ref={ref} data-slot="dialog-trigger" {...props}>
			{children}
		</DialogPrimitive.Trigger>
	);
});
DialogTrigger.displayName = "DialogTrigger";

const DialogClose = forwardRef<HTMLButtonElement, DialogSlotProps>(({ render, asChild, children, ...props }, ref) => {
	const el = slotRender(render, asChild, children);
	return el ? (
		<DialogPrimitive.Close ref={ref} data-slot="dialog-close" render={el} {...props} />
	) : (
		<DialogPrimitive.Close ref={ref} data-slot="dialog-close" {...props}>
			{children}
		</DialogPrimitive.Close>
	);
});
DialogClose.displayName = "DialogClose";

interface DialogContentProps extends HTMLAttributes<HTMLDivElement> {
	/** Max width preset at the default size step. */
	size?: "sm" | "lg" | "xl";
	/** Portal mount point. */
	container?: HTMLElement | null;
	showCloseButton?: boolean;
	/** Anchor vertically: `"center"` or `"top"`. */
	position?: "center" | "top";
	/** Optional backdrop class override. */
	overlayClassName?: string;
}

const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
	(
		{
			className,
			overlayClassName,
			children,
			size = "sm",
			container,
			showCloseButton = true,
			position = "center",
			...props
		},
		ref,
	) => {
		const icons = useIcons();
		const XIcon = icons.x;
		const shape = useShape();
		const substrate = useSurface();
		const dialogLevel = Math.min(substrate + DIALOG_OFFSET, 8);
		const compact = useSize().variant === "compact";

		const exit = useContext(DialogExitContext);
		const exitOpen = exit?.open ?? true;
		const exitActionsRef = exit?.actionsRef;
		useEffect(() => {
			if (exitOpen) return;
			const id = setTimeout(() => exitActionsRef?.current?.unmount(), exitFallbackMs(spring.slow));
			return () => clearTimeout(id);
		}, [exitOpen, exitActionsRef]);

		return (
			<DialogPrimitive.Portal container={container ?? undefined}>
				<DialogPrimitive.Backdrop
					render={(backdropProps, state) => {
						const exiting = state.transitionStatus === "ending";
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
								{...rest}
								data-slot="dialog-overlay"
								className={cn(
									container ? "absolute" : "fixed",
									"inset-0 z-[var(--z-overlay,40)] bg-black/40 dark:bg-black/80",
									overlayClassName,
								)}
								initial={{ opacity: 0 }}
								animate={{ opacity: exiting ? 0 : 1 }}
								transition={exiting ? spring.slow.exit : spring.slow}
							/>
						);
					}}
				/>
				<DialogPrimitive.Popup
					ref={ref}
					render={(popupProps, state) => {
						const exiting = state.transitionStatus === "ending";
						const { style: baseStyle, ...baseProps } = popupProps as HTMLAttributes<HTMLDivElement>;
						const rest = omit(baseProps, [
							"onDrag",
							"onDragStart",
							"onDragEnd",
							"onAnimationStart",
							"onAnimationEnd",
							"onAnimationIteration",
						]);
						const consumerRest = omit(props as HTMLAttributes<HTMLDivElement>, [
							"onDrag",
							"onDragStart",
							"onDragEnd",
							"onAnimationStart",
							"onAnimationEnd",
							"onAnimationIteration",
						]);
						return (
							<m.div
								{...rest}
								{...consumerRest}
								data-slot="dialog-content"
								className={cn(
									container ? "absolute" : "fixed",
									"left-1/2 z-[var(--z-modal,50)] w-[calc(100%-2rem)]",
									position === "top" ? "top-[12dvh]" : "top-1/2",
									surfaceClasses(dialogLevel),
									"p-6 focus:outline-none",
									size === "sm" && (compact ? "max-w-[360px]" : "max-w-[400px]"),
									size === "lg" && (compact ? "max-w-[480px]" : "max-w-[540px]"),
									size === "xl" && (compact ? "max-w-[800px]" : "max-w-[880px]"),
									shape.container,
									className,
								)}
								style={{
									...baseStyle,
									...props.style,
								}}
								initial={{ opacity: 0, scale: 0.97, x: "-50%", y: position === "top" ? 0 : "-50%" }}
								animate={{
									opacity: exiting ? 0 : 1,
									scale: exiting ? 0.97 : 1,
									x: "-50%",
									y: position === "top" ? 0 : "-50%",
								}}
								transition={exiting ? spring.slow.exit : spring.slow}
								onAnimationComplete={() => {
									if (exiting) exitActionsRef?.current?.unmount();
								}}
							>
								<SurfaceProvider value={dialogLevel}>
									{children}
									{showCloseButton && (
										<DialogPrimitive.Close
											data-slot="dialog-close"
											render={
												<Button variant="ghost" size="icon-sm" className="absolute right-3 top-3">
													<XIcon />
													<span className="sr-only">Close</span>
												</Button>
											}
										/>
									)}
								</SurfaceProvider>
							</m.div>
						);
					}}
				/>
			</DialogPrimitive.Portal>
		);
	},
);
DialogContent.displayName = "DialogContent";

function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5 mb-4", className)} {...props} />;
}

interface DialogFooterProps extends HTMLAttributes<HTMLDivElement> {
	showCloseButton?: boolean;
}

function DialogFooter({ className, showCloseButton = false, children, ...props }: DialogFooterProps) {
	return (
		<div data-slot="dialog-footer" className={cn("flex justify-end gap-2 mt-6", className)} {...props}>
			{children}
			{showCloseButton && <DialogPrimitive.Close render={<Button variant="outline">Close</Button>} />}
		</div>
	);
}

const DialogTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
	({ className, ...props }, ref) => {
		const compact = useSizeVariant() === "compact";
		return (
			<DialogPrimitive.Title
				ref={ref}
				data-slot="dialog-title"
				className={cn(typeClass("title", compact ? "compact" : "default"), "text-foreground", className)}
				style={{ fontVariationSettings: fontWeights.semibold }}
				{...props}
			/>
		);
	},
);
DialogTitle.displayName = "DialogTitle";

const DialogDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
	({ className, ...props }, ref) => {
		const compact = useSizeVariant() === "compact";
		return (
			<DialogPrimitive.Description
				ref={ref}
				data-slot="dialog-description"
				className={cn(typeClass("body", compact ? "compact" : "default"), "text-muted-foreground", className)}
				{...props}
			/>
		);
	},
);
DialogDescription.displayName = "DialogDescription";

export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
};
export type {
	DialogContentProps,
	DialogFooterProps,
	DialogProps,
	DialogSlotProps as DialogCloseProps,
	DialogSlotProps as DialogTriggerProps,
};
