import { z } from "zod/v4";

export { z };

export const ChatModeSchema = z.enum(["agent", "plan", "harness"]);

export const ChatPlanActionSchema = z.enum(["execute", "refine"]);

export const ChatThinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export const ChatTransportSchema = z.enum(["auto", "sse", "websocket"]);

export const ChatDeliveryModeSchema = z.enum(["all", "one-at-a-time"]);

export const nonEmptyStringSchema = z.string().trim().min(1);
export const nonNegativeIntSchema = z.number().int().min(0);
export const positiveIntSchema = z.number().int().min(1);

export const ChatPackageSourceSchema = z.union([nonEmptyStringSchema, z.record(z.string(), z.unknown())]);
