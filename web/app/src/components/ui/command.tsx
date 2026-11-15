import { Command as CommandPrimitive } from "cmdk";
import { Check, Search } from "lucide-react";
import type * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import { useShape } from "@/lib/fluid/shape-context";
import { typeClass, useSize } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
	const shape = useShape();
	return (
		<CommandPrimitive
			data-slot="command"
			className={cn(
				// Background comes from the enclosing surface (dialog/popover).
				"flex size-full flex-col overflow-hidden p-1 text-popover-foreground",
				shape.container,
				className,
			)}
			{...props}
		/>
	);
}

function CommandDialog({
	title = "Command Palette",
	description = "Search for a command to run…",
	children,
	className,
	showCloseButton = false,
	...props
}: Omit<React.ComponentProps<typeof Dialog>, "children"> & {
	title?: string;
	description?: string;
	className?: string;
	showCloseButton?: boolean;
	children: React.ReactNode;
}) {
	return (
		<Dialog {...props}>
			<DialogContent
				position="top"
				className={cn("overflow-hidden p-0", className)}
				showCloseButton={showCloseButton}
			>
				<DialogHeader className="sr-only">
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<Command>{children}</Command>
			</DialogContent>
		</Dialog>
	);
}

function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
	const shape = useShape();
	const compact = useSize().variant === "compact";
	return (
		<div data-slot="command-input-wrapper" className="p-1 pb-0">
			<InputGroup
				className={cn(
					"!h-8 border-border/60 bg-input/30 !shadow-none *:data-[slot=input-group-addon]:!pl-2",
					shape.input,
				)}
			>
				<CommandPrimitive.Input
					data-slot="command-input"
					className={cn(
						"w-full outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
						typeClass("body", compact ? "compact" : "default"),
						className,
					)}
					{...props}
				/>
				<InputGroupAddon>
					<Search className="size-4 shrink-0 opacity-50" />
				</InputGroupAddon>
			</InputGroup>
		</div>
	);
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
	return (
		<CommandPrimitive.List
			data-slot="command-list"
			className={cn(
				"no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto overscroll-contain outline-none",
				className,
			)}
			{...props}
		/>
	);
}

function CommandEmpty({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Empty>) {
	return (
		<CommandPrimitive.Empty
			data-slot="command-empty"
			className={cn("py-6 text-center text-sm", className)}
			{...props}
		/>
	);
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
	return (
		<CommandPrimitive.Group
			data-slot="command-group"
			className={cn(
				"overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
	return (
		<CommandPrimitive.Separator
			data-slot="command-separator"
			className={cn("-mx-1 h-px bg-border", className)}
			{...props}
		/>
	);
}

function CommandItem({ className, children, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
	const shape = useShape();
	const compact = useSize().variant === "compact";
	return (
		<CommandPrimitive.Item
			data-slot="command-item"
			className={cn(
				"group/command-item relative flex cursor-default items-center gap-2 px-2 py-1.5 outline-hidden select-none transition-colors duration-80 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 hover:bg-hover data-selected:bg-active data-selected:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-selected:*:[svg]:text-foreground",
				shape.item,
				typeClass("body", compact ? "compact" : "default"),
				className,
			)}
			{...props}
		>
			{children}
			<Check className="ml-auto opacity-0 group-data-[checked=true]/command-item:opacity-100" />
		</CommandPrimitive.Item>
	);
}

export { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator };
