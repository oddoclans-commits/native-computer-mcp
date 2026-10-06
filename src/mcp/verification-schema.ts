import { z } from "zod";

export const verificationSpecSchema = z.object({
  activeWindowTitleContains: z.string().max(512).optional(),
  activeAppNameEquals: z.string().max(256).optional(),
  windowTitleContains: z.string().max(512).optional(),
  targetQuery: z.string().max(512).optional(),
  targetRole: z.string().max(128).optional(),
  expectChanged: z.boolean().optional()
});
