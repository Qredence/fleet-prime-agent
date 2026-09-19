/**
 * Composer ghost-text completion.
 *
 * Model-free by construction: a completion is a prefix match against prompts the
 * developer already wrote, so the ghost always begins with the exact characters
 * already in the composer and can never contradict them. See
 * `@prime-agent/web-protocol/composer-completion` for the measurements that
 * ruled the model out of this path.
 */
import {
	type ComposerCompletionResponse,
	composerCompletionIgnores,
} from "@prime-agent/web-protocol/composer-completion";
import { findCompletion } from "./match";
import type { PromptIndex } from "./prompt-index";

export type ComposerCompletionService = {
	complete: (draft: string, sessionId?: string) => Promise<ComposerCompletionResponse>;
};

/**
 * Longest a request will wait for the index to come off disk.
 *
 * Reading the persisted corpus is milliseconds; this cap exists so a slow disk
 * degrades to "no ghost this time" rather than to a visible stall on a keystroke.
 */
const INDEX_READY_TIMEOUT_MS = 250;

export type ComposerCompletionServiceOptions = {
	index: PromptIndex;
};

export function createComposerCompletionService(options: ComposerCompletionServiceOptions): ComposerCompletionService {
	return {
		async complete(draft: string, sessionId?: string): Promise<ComposerCompletionResponse> {
			if (composerCompletionIgnores(draft)) return {};
			// Wait only for the corpus to be *read*, never for a rebuild: the index
			// refreshes itself in the background.
			await Promise.race([
				options.index.ready(),
				new Promise<void>((resolve) => setTimeout(resolve, INDEX_READY_TIMEOUT_MS)),
			]);
			const suggestion = findCompletion(draft, options.index.candidates(), { sessionId });
			if (!suggestion) return {};
			// History completions always extend the draft; `replace` is synthesised
			// in the browser from the intent router and never travels this payload.
			return {
				completion: suggestion.completion,
				confidence: suggestion.confidence,
				source: suggestion.source,
			};
		},
	};
}
