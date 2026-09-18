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
	complete: (draft: string) => ComposerCompletionResponse;
};

export type ComposerCompletionServiceOptions = {
	index: PromptIndex;
};

export function createComposerCompletionService(options: ComposerCompletionServiceOptions): ComposerCompletionService {
	return {
		complete(draft: string): ComposerCompletionResponse {
			if (composerCompletionIgnores(draft)) return {};
			// Candidate lookup never waits on a build: the index returns whatever it
			// has and refreshes itself in the background.
			const completion = findCompletion(draft, options.index.candidates());
			return completion ? { completion } : {};
		},
	};
}
