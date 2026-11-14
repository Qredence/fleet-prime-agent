import { describe, expect, it } from "vitest";
import { buildOpenUIRepairRequest, isRepairableError } from "@/lib/openui/openui-repair";

describe("OpenUI repair requests", () => {
	it("names the failing statement, component, and hint", () => {
		const message = buildOpenUIRepairRequest([
			{
				code: "unknown-component",
				message: 'Component "Sparkline" is not in the library.',
				statementId: "trend",
				component: "Sparkline",
				hint: "Available components include LineChart, BarChart.",
			},
		]);
		expect(message).toContain('[unknown-component] Sparkline "trend"');
		expect(message).toContain("Available components include");
		expect(message).toContain("return the corrected OpenUI block");
	});

	it("skips warnings because the program already rendered", () => {
		expect(isRepairableError({ code: "no-root", message: "used fallback", severity: "warning" })).toBe(false);
		expect(
			buildOpenUIRepairRequest([{ code: "no-root", message: "used fallback", severity: "warning" }]),
		).toBeUndefined();
	});

	it("returns undefined when there is nothing to repair", () => {
		expect(buildOpenUIRepairRequest([])).toBeUndefined();
	});

	it("deduplicates the same error reported across stream chunks", () => {
		const error = { code: "missing-required", message: "missing title", statementId: "card" } as const;
		const message = buildOpenUIRepairRequest([error, error, { ...error }]);
		expect(message?.match(/missing-required/g)).toHaveLength(1);
	});

	it("retains distinct messages for the same statement and path", () => {
		const error = { code: "unresolved", message: "missing alpha", statementId: "root" };
		const message = buildOpenUIRepairRequest([error, { ...error, message: "missing beta" }, error]);
		expect(message?.match(/missing alpha/g)).toHaveLength(1);
		expect(message).toContain("missing beta");
	});

	it("includes the prop path when present", () => {
		const message = buildOpenUIRepairRequest([
			{ code: "type-mismatch", message: "expected number", statementId: "chart", path: "/series" },
		]);
		expect(message).toContain("at /series");
	});
});
