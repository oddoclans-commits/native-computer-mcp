import { z } from "zod";

const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite()
});

const clickActionSchema = z.union([
  z.object({
    type: z.literal("click"),
    point: pointSchema,
    targetId: z.string().min(1).max(512).optional(),
    button: z.enum(["left", "middle", "right"]).optional()
  }),
  z.object({
    type: z.literal("click"),
    targetId: z.string().min(1).max(512),
    button: z.enum(["left", "middle", "right"]).optional()
  })
]);

export const actionSchema = z.union([
  clickActionSchema,
  z.object({ type: z.literal("type"), text: z.string().min(0).max(100_000) }),
  z.object({
    type: z.literal("key"),
    key: z.string().min(1).max(64),
    modifiers: z.array(z.string().min(1).max(32)).max(8).optional()
  }),
  z.object({
    type: z.literal("scroll"),
    deltaX: z.number().finite().optional(),
    deltaY: z.number().finite()
  }),
  z.object({
    type: z.literal("drag"),
    from: pointSchema,
    to: pointSchema,
    durationMs: z.number().int().min(0).max(60_000).optional()
  }),
  z.object({
    type: z.literal("set_value"),
    targetId: z.string().min(1).max(512),
    value: z.string().max(100_000)
  }),
  z.object({
    type: z.literal("secondary_action"),
    targetId: z.string().min(1).max(512)
  }),
  z.object({
    type: z.literal("activate_window"),
    windowId: z.string().min(1).max(256)
  })
]);

export const riskTierSchema = z.enum(["safe", "sensitive", "dangerous"]);
export const safetyModeSchema = z.enum(["auto", "ask", "deny"]);
