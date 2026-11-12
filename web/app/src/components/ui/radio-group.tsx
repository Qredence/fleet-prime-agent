import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cn } from "@/lib/utils";

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
	return <RadioGroupPrimitive data-slot="radio-group" className={cn("flex flex-col gap-0.5", className)} {...props} />;
}

function Radio({ className, children, ...props }: RadioPrimitive.Root.Props) {
	return (
		<RadioPrimitive.Root
			data-slot="radio"
			className={cn(
				"group/radio relative flex w-full cursor-pointer items-start gap-2 rounded-[6px] px-2 py-2 text-start text-label leading-4 text-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-foreground/6 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] data-checked:bg-foreground/6 data-disabled:cursor-not-allowed data-disabled:opacity-50",
				className,
			)}
			{...props}
		>
			{children}
		</RadioPrimitive.Root>
	);
}

/** The check mark shown on the checked radio; Base UI unmounts it when unchecked. */
function RadioIndicator({ className, ...props }: RadioPrimitive.Indicator.Props) {
	return (
		<RadioPrimitive.Indicator
			data-slot="radio-indicator"
			className={cn("shrink-0 text-foreground/60", className)}
			{...props}
		/>
	);
}

export type RadioGroupProps = RadioGroupPrimitive.Props;
export type RadioProps = RadioPrimitive.Root.Props;
export { Radio, RadioGroup, RadioIndicator };
