import { FileCode, FileJson, FileText, ImageIcon, X } from "lucide-react";
import { useState } from "react";
import { HIT_AREA_EXPAND_CLASS } from "@/components/layout/tokens";
import { ImageLightbox } from "@/components/tools/image-lightbox";
import {
	Attachment,
	AttachmentContent,
	AttachmentDescription,
	AttachmentMedia,
	AttachmentTitle,
} from "@/components/ui/attachment";
import { cn } from "@/lib/utils";

export type FileAttachmentProps = {
	id: string;
	filename: string;
	size?: number;
	isImage?: boolean;
	url?: string;
	onRemove?: () => void;
	className?: string;
	/**
	 * When true (default) clicking the thumbnail opens a fullscreen preview.
	 * Set to false to render a non-interactive image.
	 */
	enableImagePreview?: boolean;
};

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type FileIconName = "image" | "code" | "data" | "text";

const CODE_EXTENSIONS = new Set([
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
]);
const DATA_EXTENSIONS = new Set(["json", "yaml", "yml", "xml"]);

function getFileIconName(filename: string, isImage?: boolean): FileIconName {
	if (isImage) return "image";
	const extension = filename.split(".").pop()?.toLowerCase() ?? "";
	if (CODE_EXTENSIONS.has(extension)) return "code";
	if (DATA_EXTENSIONS.has(extension)) return "data";
	return "text";
}

function FileIcon({ name }: { name: FileIconName }) {
	const className = "size-4 text-muted-foreground";
	switch (name) {
		case "image":
			return <ImageIcon aria-hidden="true" className={className} />;
		case "code":
			return <FileCode aria-hidden="true" className={className} />;
		case "data":
			return <FileJson aria-hidden="true" className={className} />;
		default:
			return <FileText aria-hidden="true" className={className} />;
	}
}

/**
 * One attachment chip.
 *
 * Built on the design-system attachment parts, so the media block, text
 * truncation, and error styling come from one place rather than per-caller
 * radius arithmetic.
 */
export function FileAttachment({
	id,
	filename,
	size,
	isImage,
	url,
	onRemove,
	className,
	enableImagePreview = true,
}: FileAttachmentProps) {
	const [isLightboxOpen, setIsLightboxOpen] = useState(false);
	const canPreview = Boolean(enableImagePreview && isImage && url);
	const iconName = getFileIconName(filename, isImage);

	const media =
		isImage && url ? (
			<img src={url} alt={filename} className="h-full w-full object-cover" />
		) : (
			<FileIcon name={iconName} />
		);

	return (
		<Attachment size="sm" className={cn("max-w-[min(12.5rem,100%)]", className)}>
			{canPreview ? (
				<AttachmentMedia variant="image">
					<button
						type="button"
						aria-label={`Preview ${filename}`}
						onClick={() => setIsLightboxOpen(true)}
						className="block h-full w-full cursor-pointer focus-visible:ring-2 focus-visible:ring-ring"
					>
						{media}
					</button>
				</AttachmentMedia>
			) : (
				<AttachmentMedia variant={isImage && url ? "image" : "icon"}>{media}</AttachmentMedia>
			)}
			<AttachmentContent>
				<AttachmentTitle title={filename}>{filename}</AttachmentTitle>
				{size !== undefined && <AttachmentDescription>{formatFileSize(size)}</AttachmentDescription>}
			</AttachmentContent>
			{onRemove ? (
				<button
					type="button"
					onClick={onRemove}
					aria-label={`Remove ${filename}`}
					className={cn(
						HIT_AREA_EXPAND_CLASS,
						"absolute -top-1.5 -end-1.5 z-10 flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-[opacity,transform] duration-150 ease-out hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring enabled:active:scale-[0.96] group-hover/attachment:opacity-100 group-focus-within/attachment:opacity-100 [@media(hover:none)]:opacity-100",
					)}
				>
					<X aria-hidden="true" className="size-3" />
				</button>
			) : null}
			{canPreview && url ? (
				<ImageLightbox
					open={isLightboxOpen}
					onClose={() => setIsLightboxOpen(false)}
					images={[{ id, url, filename }]}
				/>
			) : null}
		</Attachment>
	);
}
