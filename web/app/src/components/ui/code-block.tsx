import { cva, type VariantProps } from "class-variance-authority";
import { Check, Copy } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const codeBlockVariants = cva(
	"group/code-block relative flex w-full min-w-0 flex-col overflow-hidden rounded-lg text-sm",
	{
		variants: {
			variant: {
				default: "border border-input text-foreground dark:bg-input/30",
				destructive: "border border-destructive/30 text-destructive dark:border-destructive/40",
			},
		},
		defaultVariants: { variant: "default" },
	},
);

function CodeBlock({
	className,
	variant = "default",
	size = "default",
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof codeBlockVariants> & { size?: "default" | "sm" }) {
	return (
		<div
			data-slot="code-block"
			data-variant={variant}
			data-size={size}
			className={cn(codeBlockVariants({ variant }), size === "sm" && "text-xs", className)}
			{...props}
		/>
	);
}
function CodeBlockHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="code-block-header"
			className={cn("flex min-w-0 shrink-0 items-center gap-2 px-3 pt-3 text-muted-foreground", className)}
			{...props}
		/>
	);
}
function CodeBlockTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="code-block-title"
			className={cn("min-w-0 truncate font-sans text-sm font-medium text-foreground", className)}
			{...props}
		/>
	);
}
function CodeBlockActions({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="code-block-actions"
			className={cn("ms-auto flex shrink-0 items-center gap-1", className)}
			{...props}
		/>
	);
}
function CodeBlockCopyButton({
	value,
	className,
	onClick,
	...props
}: React.ComponentProps<typeof Button> & { value: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timeout = window.setTimeout(() => setCopied(false), 1600);
		return () => window.clearTimeout(timeout);
	}, [copied]);
	return (
		<Button
			data-slot="code-block-copy-button"
			data-copied={copied || undefined}
			variant="ghost"
			size="icon-xs"
			aria-label={copied ? "Copied" : "Copy code"}
			className={className}
			onClick={(event) => {
				onClick?.(event);
				void navigator.clipboard
					?.writeText(value)
					.then(() => setCopied(true))
					.catch(() => {});
			}}
			{...props}
		>
			{copied ? <Check /> : <Copy />}
		</Button>
	);
}
function CodeBlockContent({
	className,
	children,
	style,
	wrap = false,
	lineNumbers = false,
	startLine = 1,
	...props
}: React.ComponentProps<"pre"> & { wrap?: boolean; lineNumbers?: boolean; startLine?: number }) {
	return (
		<pre
			data-slot="code-block-content"
			data-wrap={wrap || undefined}
			data-numbered={lineNumbers || undefined}
			dir="ltr"
			tabIndex={0}
			style={{ counterReset: `line ${startLine - 1}`, ...style }}
			className={cn(
				"min-h-0 min-w-0 overflow-auto px-3 py-3 text-start font-mono leading-relaxed outline-none data-wrap:break-words data-wrap:whitespace-pre-wrap",
				className,
			)}
			{...props}
		>
			<code
				data-slot="code-block-code"
				className="grid min-h-lh min-w-max content-start in-data-numbered:grid-cols-[auto_1fr] in-data-wrap:min-w-0"
			>
				{lineNumbers && typeof children === "string"
					? children
							.replace(/\n$/, "")
							.split("\n")
							.map((line, index) => <CodeBlockLine key={index}>{line}</CodeBlockLine>)
					: children}
			</code>
		</pre>
	);
}
const codeBlockLineVariants = cva(
	"relative -mx-3 block min-h-lh px-3 before:min-w-6 before:text-end before:text-muted-foreground after:absolute after:start-1 after:top-0 after:text-muted-foreground after:select-none in-data-numbered:col-span-2 in-data-numbered:grid in-data-numbered:grid-cols-subgrid in-data-numbered:gap-x-3 in-data-numbered:[counter-increment:line] in-data-numbered:before:content-[counter(line)] in-data-numbered:before:select-none",
	{
		variants: {
			variant: {
				default: "",
				added: "bg-muted after:content-['+']",
				removed: "bg-destructive/10 after:text-destructive after:content-['−']",
				highlighted: "bg-muted",
			},
		},
		defaultVariants: { variant: "default" },
	},
);
function CodeBlockLine({
	className,
	variant = "default",
	children,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof codeBlockLineVariants>) {
	const empty =
		children === undefined ||
		children === null ||
		children === "" ||
		(Array.isArray(children) && children.length === 0);
	return (
		<span
			data-slot="code-block-line"
			data-variant={variant}
			className={cn(codeBlockLineVariants({ variant }), className)}
			{...props}
		>
			<span data-slot="code-block-line-content" className="min-w-0">
				{empty ? "\n" : children}
			</span>
		</span>
	);
}
function CodeBlockFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="code-block-footer"
			className={cn("flex min-w-0 shrink-0 items-center gap-2 px-3 pb-3 text-muted-foreground", className)}
			{...props}
		/>
	);
}

export {
	CodeBlock,
	CodeBlockActions,
	CodeBlockContent,
	CodeBlockCopyButton,
	CodeBlockFooter,
	CodeBlockHeader,
	CodeBlockLine,
	CodeBlockTitle,
};
