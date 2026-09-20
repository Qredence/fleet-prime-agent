import { memo, useMemo } from "react";
import { TodoList, type TodoItem as TodoListItem } from "@/components/tools/todo-list";
import { ToolTextShimmer } from "@/components/tools/tool-text-shimmer";
import { areToolPropsEqual } from "@/components/tools/utils/format-tool";

export type TodoItem = {
	content: string;
	status: TodoListItem["status"];
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

function toTodoStatus(status: string | undefined): TodoListItem["status"] {
	if (status === "in_progress" || status === "in-progress") return "in-progress";
	if (status === "completed") return "completed";
	if (status === "cancelled") return "cancelled";
	return "pending";
}

function toTodoListItems(
	items: Array<{ content?: string; title?: string; status?: string }> | undefined,
): TodoListItem[] {
	return (items ?? []).flatMap((item, index) => {
		const title = item.title ?? item.content;
		if (!title) return [];
		return [{ id: `${index}-${title}`, title, status: toTodoStatus(item.status) }];
	});
}

export const TodoTool = memo(function TodoTool({ part }: TodoToolProps) {
	const isStreaming = part.state === "input-streaming";
	const newTodos = useMemo(
		() => toTodoListItems(part.input?.todos ?? part.output?.newTodos),
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
