import { z } from "./z";

// Re-export the patched zod instance so dependent schema modules import it from
// here; importing shared guarantees the `.openapi()` extension is registered
// before any other fragment module is evaluated.
export { z };

export const ChatModeSchema = z.enum(["agent", "plan", "harness"]).openapi({ description: "Chat mode" });

export const ChatPlanActionSchema = z.enum(["execute", "refine"]).openapi({ description: "Plan action" });

export const ChatThinkingLevelSchema = z
	.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
	.openapi({ description: "Thinking level" });

export const ChatTransportSchema = z
	.enum(["auto", "sse", "websocket"])
	.openapi({ description: "Preferred provider transport" });

export const ChatDeliveryModeSchema = z.enum(["all", "one-at-a-time"]).openapi({ description: "Prompt delivery mode" });

export const nonEmptyStringSchema = z.string().trim().min(1);
export const nonNegativeIntSchema = z.number().int().min(0);
export const positiveIntSchema = z.number().int().min(1);

export const ChatPackageSourceSchema = z.union([nonEmptyStringSchema, z.record(z.string(), z.unknown())]);
