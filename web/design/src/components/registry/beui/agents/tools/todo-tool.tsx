import { memo, useMemo } from "react";
import { type TodoItem as FleetTodoItem, TodoList } from "../todo-list";
import { ToolTextShimmer } from "../tool-text-shimmer";
import { areToolPropsEqual } from "../utils/format-tool";

export type TodoItem = {
	content: string;
	status: FleetTodoItem["status"];
	activeForm?: string;
};

export type TodoToolProps = {
	part: {
		state?: string;
		input?: { todos?: Array<{ content?: string; title?: string; status?: string }> };
		output?: {
			oldTodos?: Array<{ content?: string; title?: string; status?: string }>;
			newTodos?: Array<{ content?: string; title?: string; status?: string }>;
		};
	};
	chatStatus?: string;
};

function toFleetStatus(status: string | undefined): FleetTodoItem["status"] {
	if (status === "in_progress" || status === "in-progress") return "in-progress";
	if (status === "completed") return "completed";
	if (status === "cancelled") return "cancelled";
	return "pending";
}

function toFleetTodos(
	items: Array<{ content?: string; title?: string; status?: string }> | undefined,
): FleetTodoItem[] {
	return (items ?? []).flatMap((item, index) => {
		const title = item.title ?? item.content;
		if (!title) return [];
		return [{ id: `${index}-${title}`, title, status: toFleetStatus(item.status) }];
	});
}

export const TodoTool = memo(function TodoTool({ part }: TodoToolProps) {
	const isStreaming = part.state === "input-streaming";
	const newTodos = useMemo(
		() => toFleetTodos(part.input?.todos ?? part.output?.newTodos),
		[part.input?.todos, part.output?.newTodos],
	);

	if (isStreaming || newTodos.length === 0) {
		return (
			<ToolTextShimmer as="span" duration={1.2} className="m-0 inline-flex h-4 items-center text-label leading-none">
				Updating to-dos...
			</ToolTextShimmer>
		);
	}

	return <TodoList items={newTodos} title="Todo list" defaultOpen collapseOnComplete={false} maxHeight={240} />;
}, areToolPropsEqual);
