import { toast } from "../components/ui/toast";

function addToast(title: string, type?: string) {
	return toast.add({ title, type });
}

export const notify = Object.assign((title: string) => addToast(title), {
	success: (title: string) => addToast(title, "success"),
	error: (title: string) => addToast(title, "error"),
	message: (title: string) => addToast(title, "info"),
});
