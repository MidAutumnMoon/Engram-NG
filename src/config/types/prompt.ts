/**
 * Prompt / Worldbook Configuration Schemas
 */

import { z } from "zod";

// ==================== Prompt Template ====================

// Built-in templates are identified solely by `id` (e.g. "builtin_summary").
// Human-readable labels live next to the template definitions, not here — see
// `TEMPLATE_LABELS` in `integrations/llm/builtinPrompts.ts`.
export const promptTemplateSchema = z.object({
    id: z.string(),
    systemPrompt: z.string().default(""),
    userPromptTemplate: z.string().default(""),
    createdAt: z.number().default(() => Date.now()),
    updatedAt: z.number().default(() => Date.now()),
});

export type PromptTemplate = z.infer<typeof promptTemplateSchema>;

// ==================== Worldbook Config ====================

export const worldbookConfigSchema = z.object({
    enabled: z.boolean().default(true),
    includeGlobal: z.boolean().default(true),
    disabledWorldbooks: z.array(z.string()).default(["engram"]),
    disabledEntries: z.record(z.string(), z.array(z.number().int())).optional(),
});

export type WorldbookConfig = z.infer<typeof worldbookConfigSchema>;

// ==================== Worldbook Config Profile ====================

export const worldbookConfigProfileSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(), // For future LLM routing
    mode: z.enum(["inherit_global", "custom"]),
    selectedWorldbooks: z.array(z.string()).default([]), // Whitelist of worldbook names
    createdAt: z.number().default(() => Date.now()),
    updatedAt: z.number().default(() => Date.now()),
});

export type WorldbookConfigProfile = z.infer<
    typeof worldbookConfigProfileSchema
>;

// ==================== Derived defaults ====================

export const DEFAULT_WORLDBOOK_CONFIG: WorldbookConfig = worldbookConfigSchema
    .parse({});
