import { useEffect, useRef } from "react";

export function useToolComplete(isAnimating: boolean, duration: number, onComplete: () => void) {
	const onCompleteRef = useRef(onComplete);
	useEffect(() => {
		onCompleteRef.current = onComplete;
	}, [onComplete]);

	useEffect(() => {
		if (!isAnimating) return;
		const t = setTimeout(() => onCompleteRef.current(), duration);
		return () => clearTimeout(t);
	}, [isAnimating, duration]);
}
