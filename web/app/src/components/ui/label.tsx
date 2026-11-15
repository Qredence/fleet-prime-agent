import type * as React from "react";
import { typeClass, useSize } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
	const compact = useSize().variant === "compact";
	return (
		<label
			data-slot="label"
			className={cn(
				"flex items-center gap-2 leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
				typeClass("body", compact ? "compact" : "default"),
				className,
			)}
			{...props}
		/>
	);
}

export { Label };
