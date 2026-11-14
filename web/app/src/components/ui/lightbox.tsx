"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { type MouseEvent, useCallback, useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
		(event?: MouseEvent) => {
			event?.stopPropagation();
			setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
		},
		[images.length],
	);

	const goToNext = useCallback(
		(event?: MouseEvent) => {
			event?.stopPropagation();
			setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
		},
		[images.length],
	);

	const onLightboxKeyDown = useEffectEvent((event: KeyboardEvent) => {
		if (!hasMultipleImages) return;
		if (event.key === "ArrowLeft") {
			event.preventDefault();
			goToPrevious();
		} else if (event.key === "ArrowRight") {
			event.preventDefault();
			goToNext();
		}
	});

	useEffect(() => {
		const handler = (event: KeyboardEvent) => onLightboxKeyDown(event);
		window.addEventListener("keydown", handler, true);
		return () => window.removeEventListener("keydown", handler, true);
	}, []);

	const currentImage = images[currentIndex] ?? images[0];
	if (!currentImage?.url) return null;

	return (
		<Dialog
			open
			onOpenChange={(nextOpen) => {
				if (!nextOpen) onClose();
			}}
		>
			<DialogContent
				size="xl"
				showCloseButton={false}
				overlayClassName="bg-media-backdrop/90"
				className="flex h-[90vh] w-[95vw] max-w-none items-center justify-center border-0 bg-transparent p-0 shadow-none"
			>
				<DialogTitle className="sr-only">Image viewer</DialogTitle>

				<Button
					type="button"
					variant="ghost"
					size="icon"
					onClick={onClose}
					aria-label="Close fullscreen (Esc)"
					className="absolute top-4 right-4 z-10 rounded-full bg-media-backdrop/50 text-media-foreground hover:bg-media-backdrop/70 hover:text-media-foreground"
				>
					<X className="size-5" />
				</Button>

				{hasMultipleImages ? (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={goToPrevious}
						aria-label="Previous image (←)"
						className="absolute top-1/2 left-4 z-10 size-10 -translate-y-1/2 rounded-full bg-media-backdrop/50 text-media-foreground hover:bg-media-backdrop/70 hover:text-media-foreground"
					>
						<ChevronLeft className="size-6" />
					</Button>
				) : null}

				<img
					src={currentImage.url}
					alt={currentImage.filename ?? "Image preview"}
					className="max-h-[85vh] max-w-[90vw] object-contain select-none"
					draggable={false}
				/>

				{hasMultipleImages ? (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={goToNext}
						aria-label="Next image (→)"
						className="absolute top-1/2 right-4 z-10 size-10 -translate-y-1/2 rounded-full bg-media-backdrop/50 text-media-foreground hover:bg-media-backdrop/70 hover:text-media-foreground"
					>
						<ChevronRight className="size-6" />
					</Button>
				) : null}

				{hasMultipleImages ? (
					<div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3">
						<div className="flex gap-2">
							{images.map((image, idx) => (
								<Button
									key={image.id}
									type="button"
									variant="ghost"
									size="icon-compact"
									onClick={(event) => {
										event.stopPropagation();
										setCurrentIndex(idx);
									}}
									aria-label={`Go to image ${idx + 1}`}
									className={cn(
										"size-2 min-h-0 min-w-0 rounded-full p-0 transition-[background-color,transform] duration-150",
										idx === currentIndex
											? "scale-125 bg-media-foreground hover:bg-media-foreground"
											: "bg-media-foreground/40 hover:bg-media-foreground/60",
									)}
								/>
							))}
						</div>
						<span className="text-sm tabular-nums text-media-foreground/70">
							{currentIndex + 1} / {images.length}
						</span>
					</div>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/**
 * Fullscreen image gallery viewer built on the shared dialog and button primitives.
 */
export function ImageLightbox({ open, onClose, images, initialIndex = 0 }: ImageLightboxProps) {
	if (typeof document === "undefined" || !open) return null;

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
