import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { removeSessionOpenUIState } from "@/lib/openui/openui-state-cleanup";
import {
	decodeStoredState,
	encodeStoredState,
	readStoredState,
	writeStoredState,
} from "@/lib/openui/openui-state-store";

const PROGRAM = 'root = Root([input])\ninput = Input("q", $q)';

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe("OpenUI form-state store", () => {
	it("round-trips through the OpenUI message format", () => {
		const encoded = encodeStoredState(PROGRAM, { $q: "hello" });
		expect(encoded).toContain("]]>openui:content");
		expect(encoded).toContain("]]>openui:context");
		expect(decodeStoredState(encoded)).toEqual({ $q: "hello" });
	});

	it("keeps the program alongside the form state", () => {
		const encoded = encodeStoredState(PROGRAM, { $q: "x" });
		expect(encoded).toContain('Input("q", $q)');
	});

	it("returns undefined for a payload without form state", () => {
		expect(decodeStoredState("root = Root([])")).toBeUndefined();
	});

	it("persists and restores per session and block", () => {
		writeStoredState("session-a", "openui-0", PROGRAM, { $q: "typed" });
		expect(readStoredState("session-a", "openui-0", PROGRAM)).toEqual({ $q: "typed" });
		expect(readStoredState("session-a", "openui-1", PROGRAM)).toBeUndefined();
		expect(readStoredState("session-b", "openui-0", PROGRAM)).toBeUndefined();
	});

	it("does not restore a different branch's program at the same message position", () => {
		writeStoredState("session-a", "message:openui-0", PROGRAM, { $q: "typed" });
		expect(
			readStoredState("session-a", "message:openui-0", `${PROGRAM}\nother = Text("new branch")`),
		).toBeUndefined();
	});

	it("removes only the deleted session's forms, including legacy message keys", () => {
		writeStoredState("session-a", "message:openui-0", PROGRAM, { $q: "a" });
		writeStoredState("session-a:child", "message:openui-0", PROGRAM, { $q: "child" });
		writeStoredState("session-b", "message:openui-0", PROGRAM, { $q: "b" });
		writeStoredState("session-a-m12", "message:openui-0", PROGRAM, { $q: "other" });
		window.localStorage.setItem(
			"fleet.openui.state:session-a-m12:openui-0",
			encodeStoredState(PROGRAM, { $q: "legacy" }),
		);
		window.localStorage.setItem("unrelated", "keep");
		removeSessionOpenUIState("session-a");
		expect(readStoredState("session-a", "message:openui-0", PROGRAM)).toBeUndefined();
		expect(window.localStorage.getItem("fleet.openui.state:session-a-m12:openui-0")).toBeNull();
		expect(readStoredState("session-a:child", "message:openui-0", PROGRAM)).toEqual({ $q: "child" });
		expect(readStoredState("session-b", "message:openui-0", PROGRAM)).toEqual({ $q: "b" });
		expect(window.localStorage.getItem("unrelated")).toBe("keep");
		expect(readStoredState("session-a-m12", "message:openui-0", PROGRAM)).toEqual({ $q: "other" });
	});

	it("evicts the least recently saved form even when Storage enumerates keys differently", () => {
		window.localStorage.setItem("fleet.openui.state:legacy-m1:openui-0", "old form");
		let now = 1000;
		vi.spyOn(Date, "now").mockImplementation(() => now++);
		// Put the oldest form last in storage order, then refresh the first form.
		for (let index = 0; index < 200; index++) writeStoredState("s", `block-${index}`, PROGRAM, { $q: String(index) });
		writeStoredState("s", "block-0", PROGRAM, { $q: "fresh" });
		const keys = Array.from({ length: window.localStorage.length }, (_, index) =>
			window.localStorage.key(index),
		).reverse();
		keys.unshift("fleet.openui.state.v2:s:new");
		vi.spyOn(window.localStorage, "key").mockImplementation((index) => keys[index] ?? null);
		writeStoredState("s", "new", PROGRAM, { $q: "new" });
		expect(window.localStorage.length).toBe(200);
		expect(readStoredState("s", "block-1", PROGRAM)).toBeUndefined();
		expect(readStoredState("s", "block-0", PROGRAM)).toEqual({ $q: "fresh" });
		expect(readStoredState("s", "new", PROGRAM)).toEqual({ $q: "new" });
	});

	it("clears the entry when state becomes empty", () => {
		writeStoredState("session-a", "openui-0", PROGRAM, { $q: "typed" });
		writeStoredState("session-a", "openui-0", PROGRAM, {});
		expect(readStoredState("session-a", "openui-0", PROGRAM)).toBeUndefined();
	});

	it("omits password bindings while retaining other state, including legacy snapshots", () => {
		const program = 'root = Root([Input("secret", $pwd, null, "password"), Input("query", $q)])';
		const state = { $pwd: "private", $q: "public", secret: { value: "private" }, query: { value: "public" } };
		writeStoredState("session-a", "openui-0", program, state);
		expect(window.localStorage.getItem("fleet.openui.state.v2:session-a:openui-0")).not.toContain("private");
		expect(readStoredState("session-a", "openui-0", program)).toEqual({ $q: "public", query: { value: "public" } });
		window.localStorage.setItem("fleet.openui.state.v2:session-a:openui-0", encodeStoredState(program, state));
		expect(readStoredState("session-a", "openui-0", program)).toEqual({ $q: "public", query: { value: "public" } });
		// A changed program can also turn a previously ordinary field into a password.
		window.localStorage.setItem("fleet.openui.state.v2:session-a:openui-0", encodeStoredState(PROGRAM, state));
		expect(readStoredState("session-a", "openui-0", program)).toBeUndefined();
	});

	it("handles dynamic type, assignment bindings, conditional roots, and incomplete programs safely", () => {
		const program = '$kind = "password"\nroot = $show ? Input("secret", $pwd = $value, null, $kind) : Text("other")';
		writeStoredState("session-a", "openui-0", program, { $pwd: "private", $show: true, $kind: "password" });
		expect(window.localStorage.getItem("fleet.openui.state.v2:session-a:openui-0")).not.toContain("private");
		expect(readStoredState("session-a", "openui-0", program)).toEqual({ $show: true, $kind: "password" });
		writeStoredState("session-a", "openui-0", 'root = Input("secret", $pwd, null,', { $pwd: "private" });
		expect(window.localStorage.getItem("fleet.openui.state.v2:session-a:openui-0")).toBeNull();
	});

	it("ignores corrupt stored values instead of throwing", () => {
		window.localStorage.setItem("fleet.openui.state.v2:session-a:openui-0", "]]>openui:context\nnot json");
		expect(readStoredState("session-a", "openui-0", PROGRAM)).toBeUndefined();
	});
});
