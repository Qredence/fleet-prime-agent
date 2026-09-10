// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStoredValue, removeStoredValue, writeStoredValue } from "./safe-storage";

describe("safe browser storage", () => {
	let storage: Storage;
	let originalLocalStorage: PropertyDescriptor | undefined;

	beforeEach(() => {
		originalLocalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
		storage = {
			getItem: vi.fn(),
			key: vi.fn(),
			length: 0,
			removeItem: vi.fn(),
			setItem: vi.fn(),
		} as unknown as Storage;
		Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		if (originalLocalStorage) {
			Object.defineProperty(window, "localStorage", originalLocalStorage);
		} else {
			Reflect.deleteProperty(window, "localStorage");
		}
	});

	it("treats read failures as missing values", () => {
		vi.spyOn(storage, "getItem").mockImplementation(() => {
			throw new Error("storage blocked");
		});

		expect(readStoredValue("key")).toBeNull();
	});

	it("treats an unavailable storage getter as missing storage", () => {
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			get: () => {
				throw new Error("storage unavailable");
			},
		});

		expect(readStoredValue("key")).toBeNull();
		expect(() => writeStoredValue("key", "value")).not.toThrow();
	});

	it("ignores write failures", () => {
		vi.spyOn(storage, "setItem").mockImplementation(() => {
			throw new Error("storage quota exceeded");
		});

		expect(() => writeStoredValue("key", "value")).not.toThrow();
	});

	it("ignores remove failures", () => {
		vi.spyOn(storage, "removeItem").mockImplementation(() => {
			throw new Error("storage blocked");
		});

		expect(() => removeStoredValue("key")).not.toThrow();
	});
});
