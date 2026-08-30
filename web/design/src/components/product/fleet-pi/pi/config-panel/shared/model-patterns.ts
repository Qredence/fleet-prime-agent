import { isModelPatternEnabled, modelMatchesPattern, modelPattern } from "@prime-agent/web-protocol/model-patterns";
import type { ConfigModelInfo } from "./types";

export function customModelKey(provider: string, model: string) {
	return `${provider}/${model}`;
}

export function isModelEnabled(model: ConfigModelInfo, patterns: Array<string> | undefined) {
	return isModelPatternEnabled(
		{
			id: model.id,
			name: model.name,
			provider: model.provider,
			modelId: model.modelId,
		},
		patterns,
	);
}

export function nextEnabledModelPatterns({
	currentPatterns,
	enabled,
	model,
	models,
}: {
	currentPatterns: Array<string> | undefined;
	enabled: boolean;
	model: ConfigModelInfo;
	models: Array<ConfigModelInfo>;
}) {
	if (currentPatterns === undefined && enabled) return undefined;

	const current = currentPatterns ?? [];
	const knownModelPatterns = new Set(models.map((item) => modelPatternFor(item)));
	const activeKnown = new Set<string>();
	for (const item of models) {
		if (isModelEnabled(item, currentPatterns)) {
			activeKnown.add(modelPatternFor(item));
		}
	}

	if (enabled) {
		activeKnown.add(modelPatternFor(model));
	} else {
		activeKnown.delete(modelPatternFor(model));
	}

	const preservedPatterns = current.filter((pattern) => {
		if (knownModelPatterns.has(pattern)) return false;
		return enabled || !modelMatchesPattern(model, pattern);
	});

	return [...preservedPatterns, ...activeKnown];
}

export function modelPatternFor(model: ConfigModelInfo) {
	return modelPattern(model.provider, model.modelId);
}
