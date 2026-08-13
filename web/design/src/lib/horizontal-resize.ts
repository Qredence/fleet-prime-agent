import type { PointerEvent as ReactPointerEvent } from "react";

export function startHorizontalResize({
	event,
	getNextWidth,
	onWidthChange,
	startWidth,
	startX,
}: {
	event: ReactPointerEvent<HTMLButtonElement>;
	getNextWidth: (clientX: number, startX: number, startWidth: number) => number;
	onWidthChange: (width: number) => void;
	startWidth: number;
	startX?: number;
}) {
	event.preventDefault();
	const pointerStartX = startX ?? event.clientX;

	const handlePointerMove = (moveEvent: PointerEvent) => {
		onWidthChange(getNextWidth(moveEvent.clientX, pointerStartX, startWidth));
	};

	const handlePointerUp = () => {
		window.removeEventListener("pointermove", handlePointerMove);
		window.removeEventListener("pointerup", handlePointerUp);
	};

	window.addEventListener("pointermove", handlePointerMove);
	window.addEventListener("pointerup", handlePointerUp, { once: true });
}
