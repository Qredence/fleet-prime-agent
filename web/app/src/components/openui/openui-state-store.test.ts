import { beforeEach, describe, expect, it } from "vitest";
import {
	decodeStoredState,
	encodeStoredState,
	readStoredState,
	writeStoredState,
} from "@/components/openui/openui-state-store";

const PROGRAM = 'root = Root([input])\ninput = Input("q", $q)';

beforeEach(() => {
	window.localStorage.clear();
});

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

	it("clears the entry when state becomes empty", () => {
		writeStoredState("session-a", "openui-0", PROGRAM, { $q: "typed" });
		writeStoredState("session-a", "openui-0", PROGRAM, {});
		expect(readStoredState("session-a", "openui-0", PROGRAM)).toBeUndefined();
	});

	it("omits password bindings while retaining other state, including legacy snapshots", () => {
		const program = 'root = Root([Input("secret", $pwd, null, "password"), Input("query", $q)])';
		const state = { $pwd: "private", $q: "public", secret: { value: "private" }, query: { value: "public" } };
		writeStoredState("session-a", "openui-0", program, state);
		expect(window.localStorage.getItem("fleet.openui.state:session-a:openui-0")).not.toContain("private");
		expect(readStoredState("session-a", "openui-0", program)).toEqual({ $q: "public", query: { value: "public" } });
		window.localStorage.setItem("fleet.openui.state:session-a:openui-0", encodeStoredState(program, state));
		expect(readStoredState("session-a", "openui-0", program)).toEqual({ $q: "public", query: { value: "public" } });
		// A changed program can also turn a previously ordinary field into a password.
		window.localStorage.setItem("fleet.openui.state:session-a:openui-0", encodeStoredState(PROGRAM, state));
		expect(readStoredState("session-a", "openui-0", program)).toEqual({ $q: "public", query: { value: "public" } });
	});

	it("handles dynamic type, assignment bindings, conditional roots, and incomplete programs safely", () => {
		const program = '$kind = "password"\nroot = $show ? Input("secret", $pwd = $value, null, $kind) : Text("other")';
		writeStoredState("session-a", "openui-0", program, { $pwd: "private", $show: true, $kind: "password" });
		expect(window.localStorage.getItem("fleet.openui.state:session-a:openui-0")).not.toContain("private");
		expect(readStoredState("session-a", "openui-0", program)).toEqual({ $show: true, $kind: "password" });
		writeStoredState("session-a", "openui-0", 'root = Input("secret", $pwd, null,', { $pwd: "private" });
		expect(window.localStorage.getItem("fleet.openui.state:session-a:openui-0")).toBeNull();
	});

	it("ignores corrupt stored values instead of throwing", () => {
		window.localStorage.setItem("fleet.openui.state:session-a:openui-0", "]]>openui:context\nnot json");
		expect(readStoredState("session-a", "openui-0", PROGRAM)).toBeUndefined();
	});
});
