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
		expect(readStoredState("session-a", "openui-0")).toEqual({ $q: "typed" });
		expect(readStoredState("session-a", "openui-1")).toBeUndefined();
		expect(readStoredState("session-b", "openui-0")).toBeUndefined();
	});

	it("clears the entry when state becomes empty", () => {
		writeStoredState("session-a", "openui-0", PROGRAM, { $q: "typed" });
		writeStoredState("session-a", "openui-0", PROGRAM, {});
		expect(readStoredState("session-a", "openui-0")).toBeUndefined();
	});

	it("ignores corrupt stored values instead of throwing", () => {
		window.localStorage.setItem("fleet.openui.state:session-a:openui-0", "]]>openui:context\nnot json");
		expect(readStoredState("session-a", "openui-0")).toBeUndefined();
	});
});
