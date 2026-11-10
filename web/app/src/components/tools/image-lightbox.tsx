import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type LightboxImage = {
	/** Stable identifier — used for keys and to know which image is active. */
	id: string;
	/** Resolvable image URL (https / data: / blob:). */
	url: string;
	/** Optional filename used for the alt text. */
	filename?: string;
};

export type ImageLightboxProps = {
	/** Whether the overlay is open. */
	open: boolean;
	/** Close handler — wired to overlay click, X button, and Esc key. */
	onClose: () => void;
	/** Full set of images for gallery navigation. */
	images: Array<LightboxImage>;
	/** Index in `images` to start on. */
	initialIndex?: number;
};

type ImageLightboxOpenProps = Omit<ImageLightboxProps, "open">;

function ImageLightboxOpen({ onClose, images, initialIndex = 0 }: ImageLightboxOpenProps) {
	const [currentIndex, setCurrentIndex] = useState(initialIndex);
	const hasMultipleImages = images.length > 1;

	const goToPrevious = useCallback(
		(event?: React.MouseEvent) => {
			event?.stopPropagation();
			setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
		},
		[images.length],
	);

	const goToNext = useCallback(
		(event?: React.MouseEvent) => {
			event?.stopPropagation();
			setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
		},
		[images.length],
	);

	// Esc / arrow-key navigation. Capture phase so we beat any local handlers
	// (e.g. an Editor that swallows Esc); Esc itself is handled by the native
	// <dialog> cancel event below.
	const onLightboxKeyDown = useEffectEvent((event: KeyboardEvent) => {
		switch (event.key) {
			case "ArrowLeft":
				event.preventDefault();
				if (hasMultipleImages) goToPrevious();
				break;
			case "ArrowRight":
				event.preventDefault();
				if (hasMultipleImages) goToNext();
				break;
		}
	});

	useEffect(() => {
		const handler = (event: KeyboardEvent) => onLightboxKeyDown(event);
		window.addEventListener("keydown", handler, true);
		return () => window.removeEventListener("keydown", handler, true);
	}, []);

	// Lock body scroll while open so the page underneath doesn't move.
	useEffect(() => {
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previousOverflow;
		};
	}, []);

	const dialogRef = useRef<HTMLDialogElement>(null);

	// Light dismiss — click on the dialog's empty chrome (backdrop region).
	const onLightDismiss = useEffectEvent((event: MouseEvent) => {
		if (dialogRef.current && event.target === dialogRef.current) onClose();
	});

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (!dialog.open) dialog.showModal();
		const handler = (event: MouseEvent) => onLightDismiss(event);
		dialog.addEventListener("click", handler);
		return () => {
			dialog.removeEventListener("click", handler);
			if (dialog.open) dialog.close();
		};
	}, []);

	const currentImage = images[currentIndex] ?? images[0];
	if (!currentImage?.url) return null;

	return createPortal(
		<dialog
			ref={dialogRef}
			aria-label="Image viewer"
			onClose={() => onClose()}
			className="fixed inset-0 z-50 m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/90 p-0 backdrop:bg-transparent"
		>
			<button
				type="button"
				onClick={onClose}
				aria-label="Close fullscreen (Esc)"
				className="absolute top-4 right-4 z-10 inline-flex size-9 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
			>
				<X className="size-5" />
			</button>

			{hasMultipleImages && (
				<button
					type="button"
					onClick={goToPrevious}
					aria-label="Previous image (←)"
					className="absolute top-1/2 left-4 z-10 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
				>
					<ChevronLeft className="size-6" />
				</button>
			)}

			<img
				src={currentImage.url}
				alt={currentImage.filename ?? "Image preview"}
				className="max-h-[85vh] max-w-[90vw] object-contain select-none"
				onClick={(event) => event.stopPropagation()}
				draggable={false}
			/>

			{hasMultipleImages && (
				<button
					type="button"
					onClick={goToNext}
					aria-label="Next image (→)"
					className="absolute top-1/2 right-4 z-10 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
				>
					<ChevronRight className="size-6" />
				</button>
			)}

			{hasMultipleImages && (
				<div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3">
					<div className="flex gap-2">
						{images.map((image, idx) => (
							<button
								key={image.id}
								type="button"
								onClick={(event) => {
									event.stopPropagation();
									setCurrentIndex(idx);
								}}
								aria-label={`Go to image ${idx + 1}`}
								className={cn(
									"size-2 rounded-full transition-[background-color,transform] duration-150",
									idx === currentIndex ? "scale-125 bg-white" : "bg-white/40 hover:bg-white/60",
								)}
							/>
						))}
					</div>
					<span className="text-sm tabular-nums text-white/70">
						{currentIndex + 1} / {images.length}
					</span>
				</div>
			)}
		</dialog>,
		document.body,
	);
}

/**
 * Portal-based fullscreen image preview. Renders to `document.body` so it
 * escapes any clipping/transform/stacking context. Adapted from the
 * 21st-private-1 desktop chat — without copy/save (those are
 * desktop-API-specific).
 */
export function ImageLightbox({ open, onClose, images, initialIndex = 0 }: ImageLightboxProps) {
	if (typeof document === "undefined") return null;
	if (!open) return null;

	const galleryKey = images.map((image) => image.id).join("\0");

	return (
		<ImageLightboxOpen
			key={`${galleryKey}:${initialIndex}`}
			images={images}
			initialIndex={initialIndex}
			onClose={onClose}
		/>
	);
}
