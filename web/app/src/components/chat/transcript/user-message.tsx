import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { memo, useState } from "react";
import { FileAttachment } from "@/components/chat/file-attachment";
import { isTextPart } from "@/components/chat/transcript/chat-message-parts";
import { ImageLightbox } from "@/components/tools/image-lightbox";
import { Bubble, BubbleContent, BubbleGroup } from "@/components/ui/bubble";
import { cn } from "@/lib/utils";

export type UserMessageProps = {
	message: ChatMessage;
	className?: string;
	/**
	 * When true (default) clicking an attached image opens a fullscreen
	 * lightbox preview. Set to false to render images as plain thumbnails.
	 */
	enableImagePreview?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getImageUrlFromPart(part: unknown): string | null {
	if (!isRecord(part)) return null;
	const type = part.type;
	if (typeof type !== "string") return null;

	if (type === "image") {
		const imagePart = part as { url?: string; image?: string };
		return imagePart.url ?? imagePart.image ?? null;
	}

	if (type === "data-image") {
		const dataPart = part as { data?: { url?: string } };
		return dataPart.data?.url ?? null;
	}

	if (type === "file") {
		const filePart = part as { mimeType?: string; url?: string; data?: string };
		if (filePart.mimeType?.startsWith("image/")) {
			if (filePart.url) return filePart.url;
			if (filePart.data) {
				return `data:${filePart.mimeType};base64,${filePart.data}`;
			}
		}
	}

	return null;
}

type FilePart = {
	type: "file";
	filename?: string;
	name?: string;
	fileName?: string;
	size?: number;
	mimeType?: string;
	url?: string;
};

function getFileFromPart(part: unknown) {
	if (!isRecord(part)) return null;
	if (part.type !== "file") return null;
	const filePart = part as FilePart;
	const filename = filePart.filename || filePart.name || filePart.fileName || "Attachment";
	const isImage = filePart.mimeType?.startsWith("image/") ?? false;
	if (isImage) return null;
	return {
		filename,
		size: filePart.size,
	};
}

function collectUserMessageMedia(message: ChatMessage) {
	const images: Array<string> = [];
	const files: Array<{ filename: string; size?: number }> = [];
	for (const part of message.parts ?? []) {
		const imageUrl = getImageUrlFromPart(part);
		if (imageUrl) images.push(imageUrl);
		const file = getFileFromPart(part);
		if (file) files.push(file);
	}
	if (isRecord(message) && Array.isArray(message.experimental_attachments)) {
		for (const att of message.experimental_attachments as Array<{
			contentType?: string;
			url?: string;
		}>) {
			if (att.contentType?.startsWith("image/") && att.url) {
				images.push(att.url);
			}
		}
	}
	return { images, files };
}

function UserMessageImages({
	messageId,
	images,
	enableImagePreview,
}: {
	messageId: string;
	images: Array<string>;
	enableImagePreview: boolean;
}) {
	const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
	const imageKey = images.join("\u0000");
	const [previousImageKey, setPreviousImageKey] = useState(imageKey);
	if (previousImageKey !== imageKey) {
		const previousImages = previousImageKey.length > 0 ? previousImageKey.split("\u0000") : [];
		setPreviousImageKey(imageKey);
		setLightboxIndex((current) => {
			if (current === null) return null;
			const selected = previousImages[current];
			if (!selected) return null;
			const nextIndex = images.indexOf(selected);
			return nextIndex >= 0 ? nextIndex : null;
		});
	}
	if (images.length === 0) return null;
	const lightboxImages = images.map((url, imageIndex) => ({
		id: `${messageId}-img-${imageIndex}`,
		url,
		filename: `image-${imageIndex + 1}`,
	}));
	return (
		<>
			{images.map((url, imageIndex) => (
				<div
					key={`${messageId}-img-${imageIndex}`}
					className={cn(
						"max-w-[200px] rounded-chat-message bg-foreground/4 p-1.5",
						enableImagePreview && "cursor-pointer",
					)}
					onClick={enableImagePreview ? () => setLightboxIndex(imageIndex) : undefined}
					role={enableImagePreview ? "button" : undefined}
					tabIndex={enableImagePreview ? 0 : undefined}
					onKeyDown={
						enableImagePreview
							? (event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										setLightboxIndex(imageIndex);
									}
								}
							: undefined
					}
				>
					<img
						src={url}
						alt="attachment"
						width={184}
						height={120}
						className="block max-h-[120px] max-w-[184px] rounded-chat-message-inner object-cover"
					/>
				</div>
			))}
			{enableImagePreview ? (
				<ImageLightbox
					open={lightboxIndex !== null}
					onClose={() => setLightboxIndex(null)}
					images={lightboxImages}
					initialIndex={lightboxIndex ?? 0}
				/>
			) : null}
		</>
	);
}

function UserMessageFiles({ files }: { files: Array<{ filename: string; size?: number }> }) {
	if (files.length === 0) return null;
	return (
		<div className="flex flex-col items-end gap-2">
			{files.map((file, fileIndex) => (
				<FileAttachment
					key={`${file.filename}-${file.size ?? "unknown"}-${fileIndex}`}
					id={`${file.filename}-${fileIndex}`}
					filename={file.filename}
					size={file.size}
				/>
			))}
		</div>
	);
}

export const UserMessage = memo(function UserMessage({
	message,
	className,
	enableImagePreview = true,
}: UserMessageProps) {
	const text = (message.parts?.filter(isTextPart) ?? []).map((part) => part.text).join("");
	const { images, files } = collectUserMessageMedia(message);
	if (!text && images.length === 0 && files.length === 0) return null;

	return (
		<BubbleGroup className={cn("w-full items-end gap-1", className)}>
			<UserMessageImages messageId={message.id} images={images} enableImagePreview={enableImagePreview} />
			<UserMessageFiles files={files} />
			{text ? (
				<Bubble align="end" variant="muted" className="max-w-[85%]">
					<BubbleContent className="rounded-chat-message px-3.5 py-1.5 whitespace-pre-wrap text-pretty">
						{text}
					</BubbleContent>
				</Bubble>
			) : null}
		</BubbleGroup>
	);
});
