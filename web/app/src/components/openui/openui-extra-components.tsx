import type { ComponentRenderProps, StateField } from "@openuidev/react-lang";
import { defineComponent, reactive, useStateField } from "@openuidev/react-lang";
import { useId } from "react";
import { z } from "zod/v4";
import { Field, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

/**
 * Additional OpenUI components that map onto Fleet primitives the library did
 * not previously expose.
 *
 * Each one follows the same rules as the rest of `openui-library.tsx`: required
 * and distinctive props first (Zod key order is the positional argument order),
 * optional props last, and children rendered through `renderNode` so nested
 * generated content keeps working.
 */

const childrenProp = z.any().optional().describe("Child component, array of child components, or plain content");

// --- Tabs -------------------------------------------------------------------

function TabsComponent({
	props: { tabs, defaultIndex },
	renderNode,
}: ComponentRenderProps<{
	tabs: Array<{ label: string; content?: unknown }>;
	defaultIndex?: number;
}>) {
	const items = Array.isArray(tabs) ? tabs : [];
	if (items.length === 0) return null;
	const safeDefault = Math.min(Math.max(defaultIndex ?? 0, 0), items.length - 1);

	return (
		<Tabs defaultValue={String(safeDefault)} className="w-full">
			<TabsList className="w-full justify-start overflow-x-auto">
				{items.map((tab, index) => (
					<TabsTrigger key={`${tab.label}-${index}`} value={String(index)}>
						{tab.label}
					</TabsTrigger>
				))}
			</TabsList>
			{items.map((tab, index) => (
				<TabsContent key={`${tab.label}-${index}`} value={String(index)} className="flex flex-col gap-3">
					{renderNode(tab.content)}
				</TabsContent>
			))}
		</Tabs>
	);
}

export const TabsDef = defineComponent({
	name: "Tabs",
	description:
		"A tabbed container. Each tab has a label and its own content, so several dense sections can share one chat card.",
	props: z.object({
		tabs: z
			.array(
				z.object({
					label: z.string().describe("Tab label"),
					content: childrenProp.describe("Content shown when this tab is active"),
				}),
			)
			.describe("Tabs in display order"),
		defaultIndex: z.number().int().min(0).optional().describe("Index of the tab selected first"),
	}),
	component: TabsComponent,
});

// --- Accordion --------------------------------------------------------------

function AccordionComponent({
	props: { items },
	renderNode,
}: ComponentRenderProps<{
	items: Array<{ title: string; content?: unknown; open?: boolean }>;
}>) {
	const entries = Array.isArray(items) ? items : [];
	return (
		<div className="flex w-full flex-col gap-2">
			{entries.map((item, index) => (
				<details
					key={`${item.title}-${index}`}
					open={item.open ?? false}
					className="group w-full rounded-lg border bg-card px-3 py-2"
				>
					<summary className="cursor-pointer list-none text-sm font-medium">{item.title}</summary>
					<div className="flex flex-col gap-2 pt-2">{renderNode(item.content)}</div>
				</details>
			))}
		</div>
	);
}

export const AccordionDef = defineComponent({
	name: "Accordion",
	description: "Collapsible sections. Use it when several independent details would otherwise dominate the message.",
	props: z.object({
		items: z
			.array(
				z.object({
					title: z.string().describe("Section heading"),
					content: childrenProp.describe("Revealed content"),
					open: z.boolean().optional().describe("Whether the section starts expanded"),
				}),
			)
			.describe("Sections in display order"),
	}),
	component: AccordionComponent,
});

// --- TextArea ---------------------------------------------------------------

function TextAreaComponent({
	props: { name, value, placeholder, rows, disabled },
}: {
	props: {
		name: string;
		value: StateField<string>;
		placeholder?: string;
		rows?: number;
		disabled?: boolean;
	};
}) {
	const field = useStateField(name, value);
	const controlId = useId();

	return (
		<Field orientation="vertical" className="gap-1.5">
			<FieldLabel htmlFor={controlId} className="sr-only">
				{name}
			</FieldLabel>
			<Textarea
				id={controlId}
				value={field.value ?? ""}
				onChange={(event) => field.setValue(event.target.value)}
				placeholder={placeholder}
				rows={rows}
				disabled={disabled}
			/>
		</Field>
	);
}

export const TextAreaDef = defineComponent({
	name: "TextArea",
	description: "A multi-line, state-bound text input for longer free-form answers.",
	props: z.object({
		name: z.string().describe("Form field name for state tracking"),
		value: reactive(z.string().describe("Bound state variable")),
		placeholder: z.string().optional(),
		rows: z.number().int().min(1).max(20).optional().describe("Visible line count"),
		disabled: z.boolean().optional().default(false),
	}),
	component: TextAreaComponent,
});

// --- Slider -----------------------------------------------------------------

function SliderComponent({
	props: { name, value, label, min, max, step },
}: {
	props: {
		name: string;
		value: StateField<number>;
		label?: string;
		min?: number;
		max?: number;
		step?: number;
	};
}) {
	const field = useStateField(name, value);
	const numeric = Number(field.value ?? min ?? 0);

	return (
		<div className="flex w-full flex-col gap-1.5">
			{label ? <span className="text-xs text-muted-foreground">{label}</span> : null}
			<Slider
				value={numeric}
				onChange={(nextValue) => field.setValue(nextValue)}
				min={min ?? 0}
				max={max ?? 100}
				step={step ?? 1}
				aria-label={label ?? name}
			/>
		</div>
	);
}

export const SliderDef = defineComponent({
	name: "Slider",
	description: "A numeric range input bound to reactive state, for thresholds and limits.",
	props: z.object({
		name: z.string().describe("Form field name for state tracking"),
		value: reactive(z.number().describe("Bound numeric state variable")),
		label: z.string().optional(),
		min: z.number().optional().default(0),
		max: z.number().optional().default(100),
		step: z.number().optional().default(1),
	}),
	component: SliderComponent,
});

// --- Steps ------------------------------------------------------------------

const STEP_STATES = ["complete", "current", "pending", "failed"] as const;

const stepDotClasses: Record<(typeof STEP_STATES)[number], string> = {
	complete: "border-success bg-success",
	current: "border-primary bg-primary/30",
	pending: "border-muted-foreground/50",
	failed: "border-destructive bg-destructive",
};

function StepsComponent({
	props: { steps },
}: {
	props: { steps: Array<{ label: string; detail?: string; state?: (typeof STEP_STATES)[number] }> };
}) {
	const entries = Array.isArray(steps) ? steps : [];
	return (
		<ol className="flex w-full flex-col gap-2">
			{entries.map((step, index) => {
				const state = step.state ?? "pending";
				return (
					<li key={`${step.label}-${index}`} className="flex items-start gap-2 text-sm">
						<span
							aria-hidden="true"
							className={`mt-1 size-2 shrink-0 rounded-full border ${stepDotClasses[state]}`}
						/>
						<span className="min-w-0 flex-1">
							<span className={state === "complete" ? "text-muted-foreground line-through" : undefined}>
								{step.label}
							</span>
							{step.detail ? (
								<span className="mt-0.5 block text-xs text-muted-foreground">{step.detail}</span>
							) : null}
						</span>
					</li>
				);
			})}
		</ol>
	);
}

export const StepsDef = defineComponent({
	name: "Steps",
	description:
		"An ordered multi-step progress list with an explicit current step. Prefer it over Todo when the order and the active step matter.",
	props: z.object({
		steps: z
			.array(
				z.object({
					label: z.string(),
					detail: z.string().optional(),
					state: z.enum(STEP_STATES).optional().default("pending"),
				}),
			)
			.describe("Steps in execution order"),
	}),
	component: StepsComponent,
});

// --- KeyValueList -----------------------------------------------------------

function KeyValueListComponent({ props: { items } }: { props: { items: Array<{ label: string; value: string }> } }) {
	const entries = Array.isArray(items) ? items : [];
	return (
		<div className="flex w-full flex-col gap-1">
			{entries.map((item, index) => (
				<div
					key={`${item.label}-${index}`}
					className="flex w-full items-center justify-between gap-4 rounded-md border px-3 py-1.5 text-sm"
				>
					<span className="text-muted-foreground">{item.label}</span>
					<span className="text-right font-medium">{item.value}</span>
				</div>
			))}
		</div>
	);
}

export const KeyValueListDef = defineComponent({
	name: "KeyValueList",
	description: "Several label/value rows as one compact block, for facts that belong together.",
	props: z.object({
		items: z.array(z.object({ label: z.string(), value: z.string() })).describe("Rows to display, top to bottom"),
	}),
	component: KeyValueListComponent,
});

// --- Empty ------------------------------------------------------------------

function EmptyComponent({ props: { title, description } }: { props: { title: string; description?: string } }) {
	return (
		<div className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center">
			<span className="text-sm font-medium">{title}</span>
			{description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
		</div>
	);
}

export const EmptyDef = defineComponent({
	name: "Empty",
	description: "An explicit empty state for a query or list that returned nothing.",
	props: z.object({
		title: z.string(),
		description: z.string().optional(),
	}),
	component: EmptyComponent,
});

// --- Skeleton ---------------------------------------------------------------

function SkeletonComponent({ props: { lines } }: { props: { lines?: number } }) {
	const count = Math.min(Math.max(lines ?? 3, 1), 8);
	return (
		<div className="flex w-full flex-col gap-2" aria-hidden="true">
			{Array.from({ length: count }, (_, index) => (
				<Skeleton key={index} className="h-4 w-full" />
			))}
		</div>
	);
}

export const SkeletonDef = defineComponent({
	name: "Skeleton",
	description: "A neutral placeholder block. Use it while content is being prepared rather than describing the wait.",
	props: z.object({
		lines: z.number().int().min(1).max(8).optional().default(3).describe("Number of placeholder rows"),
	}),
	component: SkeletonComponent,
});

// --- Image ------------------------------------------------------------------

const SAFE_IMAGE_SCHEME = /^https?:\/\//i;
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);/i;

function ImageComponent({
	props: { src, alt, caption, width },
}: {
	props: { src: string; alt: string; caption?: string; width?: "compact" | "normal" | "wide" | "full" };
}) {
	const widthClass = { compact: "max-w-sm", normal: "max-w-xl", wide: "max-w-3xl", full: "max-w-none" }[
		width ?? "normal"
	];
	const isSafe = SAFE_IMAGE_SCHEME.test(src) || SAFE_DATA_IMAGE.test(src);

	if (!isSafe) {
		return (
			<div className="flex w-full flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
				<span className="font-medium">Image blocked</span>
				<span className="break-all">{alt || src}</span>
			</div>
		);
	}

	return (
		<figure className={`flex w-full flex-col gap-1 ${widthClass}`}>
			<img
				src={src}
				alt={alt}
				loading="lazy"
				referrerPolicy="no-referrer"
				className="h-auto w-full rounded-lg border object-contain"
			/>
			{caption ? <figcaption className="text-xs text-muted-foreground">{caption}</figcaption> : null}
		</figure>
	);
}

export const ImageDef = defineComponent({
	name: "Image",
	description:
		"Displays an image from an http(s) URL or an inline data image. Local files and other schemes are refused.",
	props: z.object({
		src: z.string().describe("Absolute https URL or a data:image URI"),
		alt: z.string().describe("Required alternative text"),
		caption: z.string().optional(),
		width: z.enum(["compact", "normal", "wide", "full"]).optional().default("normal"),
	}),
	component: ImageComponent,
});
