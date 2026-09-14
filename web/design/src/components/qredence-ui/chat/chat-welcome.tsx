import type { SuggestionItem } from "@prime-agent/web-design/components/qredence-ui/chat/input/suggestions";
import type { ReactNode } from "react";
import { Button } from "../../ui/button";
import { SUGGESTION_ITEM_CLASS } from "../chrome/tokens";

const WELCOME_TASKS: SuggestionItem[] = [
	{
		id: "welcome-explore-codebase",
		label: "Explore codebase",
		value: "Explore this codebase and explain its architecture, important modules, and main entry points.",
	},
	{
		id: "welcome-review-changes",
		label: "Review changes",
		value: "Review my current changes for bugs, regressions, architecture issues, and code quality problems.",
	},
	{
		id: "welcome-fix-issue",
		label: "Fix an issue",
		value: "Help me investigate and fix an issue in this project.",
	},
	{
		id: "welcome-plan-feature",
		label: "Plan a feature",
		value: "Explore the relevant code and create an implementation plan for a new feature before making changes.",
	},
];

/**
 * Renders the empty-conversation welcome screen with a composer and preset prompt actions.
 *
 * @param disabled - Whether all prompt actions are disabled
 * @param onSelect - Callback invoked with the selected prompt
 * @param composer - Composer content rendered below the welcome heading
 */
export function ChatWelcome({
	disabled,
	onSelect,
	composer,
}: {
	disabled: boolean;
	onSelect: (item: SuggestionItem) => void;
	composer: ReactNode;
}) {
	return (
		<section aria-labelledby="welcome-title" className="flex w-full flex-col items-center text-center">
			<h1
				id="welcome-title"
				className="text-balance text-2xl font-normal tracking-tight text-foreground sm:text-3xl"
			>
				What should Fleet Prime Agent work on?
			</h1>
			<div className="mt-6 w-full">{composer}</div>
			<div aria-label="Suggested prompts" className="mt-4 flex w-full flex-wrap justify-center gap-2">
				{WELCOME_TASKS.map((item) => (
					<Button
						key={item.id}
						type="button"
						variant="outline"
						size="sm"
						disabled={disabled || item.disabled}
						onClick={() => onSelect(item)}
						className={SUGGESTION_ITEM_CLASS}
					>
						{item.label}
					</Button>
				))}
			</div>
		</section>
	);
}
