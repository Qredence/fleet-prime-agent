import { describe, expect, it } from "vitest";
import { getChartColorVarName, sanitizeChartColor, sanitizeChartToken } from "@/components/ui/chart";

describe("chart token and color helpers", () => {
	it("normalizes chart keys into safe CSS custom-property names", () => {
		expect(sanitizeChartToken("task status/value")).toBe("task_status_value");
		expect(getChartColorVarName("task status/value")).toBe("--color-task_status_value");
	});

	it("accepts supported CSS color formats and trims surrounding whitespace", () => {
		expect(sanitizeChartColor(" #abc ")).toBe("#abc");
		expect(sanitizeChartColor("#12ab34cd")).toBe("#12ab34cd");
		expect(sanitizeChartColor("var(--chart-1)")).toBe("var(--chart-1)");
		expect(sanitizeChartColor("rgb(10 20 30 / 50%)")).toBe("rgb(10 20 30 / 50%)");
		expect(sanitizeChartColor("hsl(120 50% 50%)")).toBe("hsl(120 50% 50%)");
	});

	it("rejects CSS injection and unsupported color syntax", () => {
		expect(sanitizeChartColor("red; background: url(https://example.test)")).toBeUndefined();
		expect(sanitizeChartColor("url(javascript:alert(1))")).toBeUndefined();
		expect(sanitizeChartColor("var(--chart); color: red")).toBeUndefined();
		expect(sanitizeChartColor("currentColor")).toBeUndefined();
	});
});
