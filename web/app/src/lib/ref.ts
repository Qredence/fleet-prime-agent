import type { Ref } from "react";

/** Assigns a DOM node to a React ref or ref callback. */
export function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
	if (typeof ref === "function") {
		ref(value);
		return;
	}
	if (ref) {
		ref.current = value;
	}
}
