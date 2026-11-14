"use client";

import { forwardRef, useRef, useState, type InputHTMLAttributes } from "react";
import { fontWeights } from "@/lib/fluid/font-weight";
import { useIcons } from "@/lib/fluid/icon-context";
import { nestedRadius, useShape } from "@/lib/fluid/shape-context";
import { useSize, type SizeVariant } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

const inputClasses = [
	"w-full min-w-0 border border-border bg-transparent text-foreground outline-none",
	"transition-[background-color,border-color] duration-80",
	"placeholder:text-muted-foreground",
	"hover:bg-hover",
	"aria-invalid:border-destructive/50",
	// Focus wins over the error tint while the value is fixed.
	"focus:border-foreground/40 aria-invalid:focus:border-foreground/40 focus:hover:bg-transparent",
	"disabled:opacity-50 disabled:pointer-events-none",
	"file:mr-2 file:cursor-pointer file:border-0 file:bg-transparent file:p-0 file:font-[inherit] file:text-[length:inherit] file:text-foreground",
];

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
	/** Pins the field to one step of the size ladder (default 36px, compact 28px). */
	size?: SizeVariant;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
	({ className, size, type = "text", style, onChange, ...props }, ref) => {
		const shape = useShape();
		const sizeClasses = useSize(size);
		const compact = sizeClasses.variant === "compact";
		const icons = useIcons();
		const FileIcon = icons.file;
		const MinusIcon = icons.minus;
		const PlusIcon = icons.plus;
		const inputRef = useRef<HTMLInputElement | null>(null);
		const [hasFile, setHasFile] = useState(false);
		const isFile = type === "file";
		const isNumber = type === "number";

		const stepInset = compact ? 2 : 4;
		const stepRadius = nestedRadius(shape.bgRadius, stepInset);

		const step = (direction: 1 | -1) => {
			const el = inputRef.current;
			if (!el || el.disabled || el.readOnly) return;
			if (el.step === "any") {
				const min = el.min === "" ? -Infinity : Number(el.min);
				const max = el.max === "" ? Infinity : Number(el.max);
				const next = Math.min(max, Math.max(min, (Number(el.value) || 0) + direction));
				Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, String(next));
			} else if (direction === 1) {
				el.stepUp();
			} else {
				el.stepDown();
			}
			el.dispatchEvent(new Event("input", { bubbles: true }));
		};

		const input = (
			<input
				ref={(node) => {
					inputRef.current = node;
					if (typeof ref === "function") ref(node);
					else if (ref) ref.current = node;
				}}
				type={type}
				data-slot="input"
				className={cn(
					inputClasses,
					shape.input,
					sizeClasses.control,
					sizeClasses.px,
					sizeClasses.field,
					isFile && [compact ? "py-1 pl-7" : "py-[7px] pl-9", !hasFile && "text-muted-foreground"],
					isNumber && [
						"[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
						compact ? "pr-[54px]" : "pr-[68px]",
					],
					className,
				)}
				style={{ fontVariationSettings: fontWeights.normal, ...style }}
				onChange={(e) => {
					if (isFile) setHasFile(Boolean(e.currentTarget.files?.length));
					onChange?.(e);
				}}
				{...props}
			/>
		);

		if (isFile) {
			return (
				<span data-slot="input-file" className="relative block w-full min-w-0">
					<FileIcon
						size={sizeClasses.icon}
						strokeWidth={1.5}
						aria-hidden
						className={cn(
							"pointer-events-none absolute top-1/2 -translate-y-1/2 transition-colors duration-80",
							compact ? "left-2.5" : "left-3",
							hasFile ? "text-foreground" : "text-muted-foreground",
						)}
					/>
					{input}
				</span>
			);
		}

		if (isNumber) {
			const stepButton = (direction: 1 | -1) => {
				const Icon = direction === 1 ? PlusIcon : MinusIcon;
				return (
					<button
						type="button"
						tabIndex={-1}
						aria-label={direction === 1 ? "Increase" : "Decrease"}
						disabled={props.disabled || props.readOnly}
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => step(direction)}
						className={cn(
							"group/step flex shrink-0 cursor-pointer items-center justify-center text-muted-foreground outline-none",
							"transition-colors duration-80 hover:bg-hover hover:text-foreground",
							"disabled:pointer-events-none",
							compact ? "size-6" : "size-7",
						)}
						style={{ borderRadius: stepRadius }}
					>
						<Icon size={sizeClasses.icon} strokeWidth={1.5} aria-hidden />
					</button>
				);
			};

			return (
				<span data-slot="input-number" className="relative block w-full min-w-0">
					{input}
					<span className="absolute inset-y-0 flex items-center" style={{ right: stepInset }}>
						{stepButton(-1)}
						{stepButton(1)}
					</span>
				</span>
			);
		}

		return input;
	},
);

Input.displayName = "Input";

export { Input, inputClasses };
export type { InputProps };
export default Input;
