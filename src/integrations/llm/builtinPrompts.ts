/**
 * Built-in prompt templates, defined as source.
 *
 * Prompt bodies live as plain `.txt` files in `./prompts/` and are inlined at
 * build time via Vite's `?raw` import. This keeps the long, mostly-CJK strings
 * out of the TS source (no backtick/`${}` escaping gymnastics).
 *
 * `BUILTIN_PROMPTS` is the display source for the read-only 提示词模板 panel.
 * Runtime prompt assembly is done inline in each pipeline
 * (`domain/memory/pipelines/{summary,entity,trim}.ts`) — those import the
 * `.txt` files directly too; this array is no longer part of the runtime
 * prompt path.
 */
import type { PromptTemplate } from "@/config/types/prompt.ts";

import ENTITY_EXTRACTION_SYSTEM from "./prompts/ENTITY_EXTRACTION_SYSTEM.txt?raw";
import ENTITY_EXTRACTION_USER from "./prompts/ENTITY_EXTRACTION_USER.txt?raw";
import SUMMARY_SYSTEM from "./prompts/SUMMARY_SYSTEM.txt?raw";
import SUMMARY_USER from "./prompts/SUMMARY_USER.txt?raw";
import TRIM_SYSTEM from "./prompts/TRIM_SYSTEM.txt?raw";
import TRIM_USER from "./prompts/TRIM_USER.txt?raw";

// ==================== Template objects ====================

/**
 * Built-in prompt templates for UI display. Identified solely by `id`.
 *
 * createdAt/updatedAt are 0: these are immutable defaults baked into the
 * bundle, not records created "now".
 */
function makeTemplate(
    id: string,
    systemPrompt: string,
    userPromptTemplate: string,
): PromptTemplate {
    return {
        id,
        systemPrompt,
        userPromptTemplate,
        createdAt: 0,
        updatedAt: 0,
    };
}

export const BUILTIN_PROMPTS: PromptTemplate[] = [
    makeTemplate("builtin_summary", SUMMARY_SYSTEM, SUMMARY_USER),
    makeTemplate("builtin_trim", TRIM_SYSTEM, TRIM_USER),
    makeTemplate(
        "builtin_entity_extraction",
        ENTITY_EXTRACTION_SYSTEM,
        ENTITY_EXTRACTION_USER,
    ),
];

/**
 * Human-readable labels for the UI. Pure display hint — not part of the
 * persisted/runtime model, which keys only on `id`.
 */
export const TEMPLATE_LABELS: Record<string, string> = {
    builtin_entity_extraction: "实体提取",
    builtin_summary: "剧情摘要",
    builtin_trim: "记忆精简",
};

/** Human-readable label for a template id, falling back to the id itself. */
export function getTemplateLabel(id: string): string {
    return TEMPLATE_LABELS[id] ?? id;
}

/** Find a built-in template by id. */
export function getBuiltinById(id: string): PromptTemplate | undefined {
    return BUILTIN_PROMPTS.find((t) => t.id === id);
}
