import { FileCode, FileJson, FileText, ImageIcon, X } from "lucide-react";
import { useState } from "react";
import { HIT_AREA_EXPAND_CLASS } from "@/components/qredence-ui/chrome/tokens";
import { ImageLightbox } from "@/components/qredence-ui/tools/image-lightbox";
import { cn } from "@/lib/utils";

export type FileAttachmentProps = {
	id: string;
	filename: string;
	size?: number;
	isImage?: boolean;
	url?: string;
	onRemove?: () => void;
	className?: string;
	display?: "chip" | "image-only";
	/**
	 * When true (default) clicking the image thumbnail opens a fullscreen
	 * preview. Set to false to render a non-interactive thumbnail.
	 */
	enableImagePreview?: boolean;
};

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type FileIconName = "image" | "code" | "data" | "text";

function getFileIconName(filename: string, isImage?: boolean): FileIconName {
	if (isImage) return "image";

	const ext = filename.split(".").pop()?.toLowerCase();

	if (
		[
			"js",
			"ts",
			"jsx",
			"tsx",
			"py",
			"rb",
			"go",
			"rs",
			"java",
			"kt",
			"swift",
			"c",
			"cpp",
			"h",
			"hpp",
			"cs",
			"php",
		].includes(ext || "")
	) {
		return "code";
	}

	if (["json", "yaml", "yml", "xml"].includes(ext || "")) {
		return "data";
	}

	return "text";
}

function renderFileIcon(iconName: FileIconName) {
	switch (iconName) {
		case "image":
			return <ImageIcon aria-hidden="true" className="size-4 text-muted-foreground" />;
		case "code":
			return <FileCode aria-hidden="true" className="size-4 text-muted-foreground" />;
		case "data":
			return <FileJson aria-hidden="true" className="size-4 text-muted-foreground" />;
		default:
			return <FileText aria-hidden="true" className="size-4 text-muted-foreground" />;
	}
}

export function FileAttachment({
	id,
	filename,
	size,
	isImage,
	url,
	onRemove,
	className,
	display = "chip",
	enableImagePreview = true,
}: FileAttachmentProps) {
	const [isHovered, setIsHovered] = useState(false);
	const [isLightboxOpen, setIsLightboxOpen] = useState(false);
	const iconName = getFileIconName(filename, isImage);
	const isImageOnly = display === "image-only" && isImage && !!url;
	const canPreview = Boolean(enableImagePreview && isImage && url);

	const openLightbox = (event?: React.SyntheticEvent) => {
		event?.stopPropagation();
		setIsLightboxOpen(true);
	};

	const previewButtonClass = cn(
		"shrink-0 overflow-hidden rounded-[calc(var(--chat-input-radius)-var(--chat-context-padding)-2px)]",
		canPreview && "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring",
	);

	return (
		<div
			className={cn(
				"group relative rounded-[calc(var(--chat-input-radius)-var(--chat-context-padding))] bg-muted/50",
				isImageOnly
					? "flex size-10 items-center justify-center"
					: "flex max-w-[min(12.5rem,100%)] min-w-0 items-center gap-2 py-1 ps-1 pe-2",
				className,
			)}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			{isImageOnly ? (
				canPreview ? (
					<button
						type="button"
						className={cn(previewButtonClass, "size-8 border-0 bg-transparent p-0")}
						onClick={openLightbox}
						aria-label={`Preview ${filename}`}
					>
						<img src={url} alt="" className="h-full w-full object-cover" />
					</button>
				) : (
					<div className={cn(previewButtonClass, "size-8")}>
						<img src={url} alt={filename} className="h-full w-full object-cover" />
					</div>
				)
			) : (
				<>
					{isImage && url ? (
						canPreview ? (
							<button
								type="button"
								className={cn(previewButtonClass, "w-8 self-stretch border-0 bg-transparent p-0")}
								onClick={openLightbox}
								aria-label={`Preview ${filename}`}
							>
								<img src={url} alt="" className="aspect-square h-full w-full object-cover" />
							</button>
						) : (
							<div className={cn(previewButtonClass, "w-8 self-stretch")}>
								<img src={url} alt={filename} className="aspect-square h-full w-full object-cover" />
							</div>
						)
					) : (
						<div className="flex w-8 shrink-0 items-center justify-center self-stretch rounded-[calc(var(--chat-input-radius)-var(--chat-context-padding)-2px)] bg-muted">
							{renderFileIcon(iconName)}
						</div>
					)}

					<div className="flex min-w-0 flex-col">
						<span className="truncate text-sm font-medium text-foreground" title={filename}>
							{filename}
						</span>
						{size !== undefined && (
							<span className="text-micro text-muted-foreground">{formatFileSize(size)}</span>
						)}
					</div>
				</>
			)}

			{onRemove && (
				<button
					onClick={(e) => {
						e.stopPropagation();
						onRemove();
					}}
					aria-label={`Remove ${filename}`}
					className={cn(
						HIT_AREA_EXPAND_CLASS,
						"absolute -top-1.5 -end-1.5 z-10 flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-[opacity,transform] duration-150 ease-out hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100",
						isHovered ? "opacity-100" : "opacity-0",
					)}
					type="button"
				>
					<X aria-hidden="true" className="size-3" />
				</button>
			)}

			{canPreview && url && (
				<ImageLightbox
					open={isLightboxOpen}
					onClose={() => setIsLightboxOpen(false)}
					images={[{ id, url, filename }]}
				/>
			)}
		</div>
	);
}
