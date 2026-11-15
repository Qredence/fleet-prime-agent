import { useShape } from "@/lib/fluid/shape-context";
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	const shape = useShape();
	return <div data-slot="skeleton" className={cn("animate-pulse bg-muted", shape.item, className)} {...props} />;
}

export { Skeleton };
