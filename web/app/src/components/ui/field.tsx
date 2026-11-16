"use client";

import { forwardRef, useEffect, useId, useRef, useState, type HTMLAttributes, type LabelHTMLAttributes } from "react";
import { Label } from "@/components/ui/label";
import { fontWeights } from "@/lib/fluid/font-weight";
import { FieldLabelIdContext } from "@/components/ui/field-context";
import { useShape } from "@/lib/fluid/shape-context";
import { useSize } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

const FieldGroup = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		data-slot="field-group"
		className={cn("@container/field-group flex w-full flex-col gap-3", className)}
		{...props}
	/>
));
FieldGroup.displayName = "FieldGroup";

type FieldOrientation = "vertical" | "horizontal" | "responsive";

const orientationClasses: Record<FieldOrientation, string> = {
	vertical: "flex-col gap-1",
	horizontal:
		"flex-row items-center has-[>[data-slot=field-content]]:items-start has-[>[data-slot=field-content]]:[&>[data-slot=checkbox]]:mt-0.5",
	responsive:
		"flex-col gap-1 @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:has-[>[data-slot=field-content]]:[&>[data-slot=checkbox]]:mt-0.5",
};

const LIBRARY_CONTROL =
	"[data-slot=input], [data-slot=input-group-control], [data-slot=textarea], [data-slot=checkbox], [data-slot=switch], [role=combobox]";
const NATIVE_CONTROL = "input:not([type=hidden]):not([aria-hidden=true]), textarea, select";
const CONTROL_SELECTOR = `${LIBRARY_CONTROL}, ${NATIVE_CONTROL}`;

function mergeManagedIds(element: HTMLElement, attribute: "aria-describedby" | "aria-labelledby", managed: string) {
	const datasetKey = attribute === "aria-describedby" ? "fieldDescribedby" : "fieldLabelledby";
	const previous = new Set((element.dataset[datasetKey] ?? "").split(" ").filter(Boolean));
	const existing = (element.getAttribute(attribute) ?? "").split(" ").filter((id) => id && !previous.has(id));
	const next = [...existing, ...managed.split(" ").filter(Boolean)];
	if (next.length) element.setAttribute(attribute, next.join(" "));
	else element.removeAttribute(attribute);
	element.dataset[datasetKey] = managed;
}

function linkFieldSemantics(root: HTMLElement, generatedId: string) {
	const own = (el: Element) => el.closest("[data-slot=field]") === root;
	const controls = Array.from(root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)).filter(own);
	const labels = Array.from(root.querySelectorAll<HTMLLabelElement>("[data-slot=field-label]")).filter(own);
	const label = labels[0];

	if (label && controls.length === 1) {
		const control = controls[0];
		if (control) {
			if (!label.id) label.id = `${generatedId}-label`;
			if (control.matches("input, textarea, select, button")) {
				if (!label.htmlFor || label.htmlFor === control.id) {
					if (!control.id) control.id = generatedId;
					label.htmlFor = control.id;
					mergeManagedIds(control, "aria-labelledby", label.id);
				}
			} else {
				label.removeAttribute("for");
				mergeManagedIds(control, "aria-labelledby", label.id);
			}
		}
	} else if (label && controls.length > 1 && !label.htmlFor) {
		if (!label.id) label.id = `${generatedId}-label`;
		if (!root.hasAttribute("role")) root.setAttribute("role", "group");
		mergeManagedIds(root, "aria-labelledby", label.id);
	}

	const descriptionIds: Array<string> = [];
	for (const element of root.querySelectorAll<HTMLElement>("[data-slot=field-description]")) {
		if (own(element) && element.id) descriptionIds.push(element.id);
	}
	const describedBy = descriptionIds.join(" ");
	if (controls.length === 1) {
		const control = controls[0];
		if (control) mergeManagedIds(control, "aria-describedby", describedBy);
	} else if (controls.length > 1) {
		mergeManagedIds(root, "aria-describedby", describedBy);
	}
}

interface FieldProps extends HTMLAttributes<HTMLDivElement> {
	/** Stack the label above the control, put them side by side, or switch at container width. */
	orientation?: FieldOrientation;
}

const Field = forwardRef<HTMLDivElement, FieldProps>(({ className, orientation = "vertical", ...props }, ref) => {
	const sizeClasses = useSize();
	const rootRef = useRef<HTMLDivElement | null>(null);
	const fieldId = useId();
	const children = props.children;
	const [linkedLabelId, setLinkedLabelId] = useState<string>();

	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		linkFieldSemantics(root, fieldId);
		const labelId = Array.from(root.querySelectorAll<HTMLLabelElement>("[data-slot=field-label]")).find(
			(label) => label.closest("[data-slot=field]") === root,
		)?.id;
		setLinkedLabelId((current) => (current === labelId ? current : labelId));
	}, [children, fieldId]);

	const named = props["aria-label"] || props["aria-labelledby"];

	return (
		<FieldLabelIdContext.Provider value={linkedLabelId}>
			<div
				ref={(node) => {
					rootRef.current = node;
					if (typeof ref === "function") ref(node);
					else if (ref) ref.current = node;
				}}
				role={named ? "group" : undefined}
				data-slot="field"
				data-orientation={orientation}
				className={cn(
					"group/field flex w-full",
					orientationClasses[orientation],
					orientation === "horizontal" && sizeClasses.gap,
					orientation === "responsive" &&
						(sizeClasses.variant === "compact" ? "@md/field-group:gap-1" : "@md/field-group:gap-2"),
					className,
				)}
				{...props}
			/>
		</FieldLabelIdContext.Provider>
	);
});
Field.displayName = "Field";

const FieldLabel = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
	({ className, style, ...props }, ref) => {
		const sizeClasses = useSize();
		const shape = useShape();
		return (
			<Label
				ref={ref}
				data-slot="field-label"
				className={cn(
					"w-fit font-normal",
					sizeClasses.type.body,
					"text-muted-foreground group-data-[orientation=horizontal]/field:text-foreground",
					"group-data-[invalid=true]/field:text-destructive",
					"has-[>[data-slot=field]]:block has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:border has-[>[data-slot=field]]:border-border",
					{
						rounded: "has-[>[data-slot=field]]:rounded-md",
						sharp: "has-[>[data-slot=field]]:rounded-[1px]",
					}[shape.variant],
					sizeClasses.variant === "compact" ? "has-[>[data-slot=field]]:p-2.5" : "has-[>[data-slot=field]]:p-3",
					"has-[>[data-slot=field]]:transition-[background-color,border-color] has-[>[data-slot=field]]:duration-80 has-[>[data-slot=field]]:hover:bg-hover",
					"has-[>[data-slot=field]]:hover:[&_[data-slot=checkbox]:not([data-disabled]):not(:disabled):not([aria-invalid=true])]:border-foreground/40",
					"has-[[data-state=checked]]:border-foreground/40 has-[[data-checked]]:border-foreground/40",
					"has-[>[data-slot=field]]:has-focus-visible:ring-1 has-[>[data-slot=field]]:has-focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
					"has-[>[data-slot=field]]:[&_[data-slot=checkbox]:focus-visible]:ring-0",
					className,
				)}
				style={{ fontVariationSettings: fontWeights.normal, ...style }}
				{...props}
			/>
		);
	},
);
FieldLabel.displayName = "FieldLabel";

const FieldDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
	({ className, style, id, ...props }, ref) => {
		const sizeClasses = useSize();
		const autoId = useId();
		return (
			<p
				ref={ref}
				id={id ?? autoId}
				data-slot="field-description"
				className={cn(sizeClasses.type.caption, "text-pretty text-muted-foreground", className)}
				style={{ fontVariationSettings: fontWeights.normal, ...style }}
				{...props}
			/>
		);
	},
);
FieldDescription.displayName = "FieldDescription";

export { Field, FieldDescription, FieldGroup, FieldLabel };
