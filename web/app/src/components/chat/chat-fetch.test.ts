import { describe, expect, it, vi } from "vitest";
import { ChatStreamContractError, readChatStream } from "./chat-fetch";

describe("chat stream contract", () => {
	it("preserves delivered events and safely reports a malformed structural event", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const sensitive = "private-tool-argument";
		const events: unknown[] = [];
		const body = [
			{ type: "delta", messageId: "assistant-1", text: "partial answer" },
			{ type: "tool", part: { type: "tool-python", input: sensitive, durationMs: "invalid" } },
			{ type: "delta", messageId: "assistant-1", text: "not delivered" },
		]
			.map((event) => JSON.stringify(event))
			.join("\n");
		await expect(readChatStream(new Response(body), (event) => events.push(event))).rejects.toBeInstanceOf(
			ChatStreamContractError,
		);
		expect(events).toEqual([{ type: "delta", messageId: "assistant-1", text: "partial answer" }]);
		const diagnostic = String(log.mock.calls[0]?.[0]);
		expect(diagnostic).toContain('"type":"tool"');
		expect(diagnostic).toContain("durationMs");
		expect(diagnostic).not.toContain(sensitive);
		log.mockRestore();
	});

	it("classifies malformed NDJSON as a contract error and cancels the reader", async () => {
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("{not json}\n"));
			},
			cancel,
		});
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(readChatStream(new Response(body), () => undefined)).rejects.toBeInstanceOf(ChatStreamContractError);
		expect(cancel).toHaveBeenCalledOnce();
		expect(String(log.mock.calls[0]?.[0])).toContain("invalid_json");
		log.mockRestore();
	});

	it("preserves callback exceptions while cancelling the reader", async () => {
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"type":"delta","text":"hi"}\n'));
			},
			cancel,
		});
		const callbackError = new Error("callback failed");
		await expect(
			readChatStream(new Response(body), () => {
				throw callbackError;
			}),
		).rejects.toBe(callbackError);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("parses UTF-8 characters split across chunks and an unterminated final frame", async () => {
		const encoded = new TextEncoder().encode('{"type":"delta","text":"🙂"}');
		const splitAt = encoded.indexOf(0xf0) + 2;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoded.slice(0, splitAt));
				controller.enqueue(encoded.slice(splitAt));
				controller.close();
			},
		});
		const events: unknown[] = [];
		await readChatStream(new Response(body), (event) => events.push(event));
		expect(events).toEqual([{ type: "delta", text: "🙂" }]);
	});
});
