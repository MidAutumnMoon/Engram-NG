/**
 * Built-in prompt templates, defined as source.
 *
 * Prompt bodies live as plain `.txt` files in `./prompts/` and are inlined at
 * build time via Vite's `?raw` import. This keeps the long, mostly-CJK strings
 * out of the TS source (no backtick/`${}` escaping gymnastics) while staying
 * type-safe and import-traceable — no runtime YAML parsing, no `js-yaml`.
 */
import type {
    PromptCategory,
    PromptTemplate,
} from "@/config/types/prompt.ts";

import ENTITY_EXTRACTION_SYSTEM from "./prompts/ENTITY_EXTRACTION_SYSTEM.txt?raw";
import ENTITY_EXTRACTION_USER from "./prompts/ENTITY_EXTRACTION_USER.txt?raw";
import ENTITY_RESOLVE_SYSTEM from "./prompts/ENTITY_RESOLVE_SYSTEM.txt?raw";
import ENTITY_RESOLVE_USER from "./prompts/ENTITY_RESOLVE_USER.txt?raw";
import SUMMARY_SYSTEM from "./prompts/SUMMARY_SYSTEM.txt?raw";
import SUMMARY_USER from "./prompts/SUMMARY_USER.txt?raw";
import TRIM_SYSTEM from "./prompts/TRIM_SYSTEM.txt?raw";
import TRIM_USER from "./prompts/TRIM_USER.txt?raw";

// ==================== Template objects ====================

/**
 * Build-time built-in prompt templates.
 *
 * createdAt/updatedAt are 0: these are immutable defaults baked into the
 * bundle, not records created "now". User-provided templates get real
 * timestamps via the schema defaults.
 */
function makeTemplate(
    id: string,
    name: string,
    category: PromptCategory,
    systemPrompt: string,
    userPromptTemplate: string,
): PromptTemplate {
    return {
        id,
        name,
        category,
        systemPrompt,
        userPromptTemplate,
        createdAt: 0,
        updatedAt: 0,
    };
}

export const BUILTIN_PROMPTS: PromptTemplate[] = [
    makeTemplate(
        "builtin_summary",
        "剧情摘要 (增强对话保留版)",
        "summary",
        SUMMARY_SYSTEM,
        SUMMARY_USER,
    ),
    makeTemplate(
        "builtin_trim",
        "记忆精简",
        "trim",
        TRIM_SYSTEM,
        TRIM_USER,
    ),
    makeTemplate(
        "builtin_entity_extraction",
        "实体提取",
        "entity_extraction",
        ENTITY_EXTRACTION_SYSTEM,
        ENTITY_EXTRACTION_USER,
    ),
    makeTemplate(
        "builtin_entity_resolve",
        "实体解析",
        "entity_resolve",
        ENTITY_RESOLVE_SYSTEM,
        ENTITY_RESOLVE_USER,
    ),
];

/** Find a built-in template by id. */
export function getBuiltinById(id: string): PromptTemplate | undefined {
    return BUILTIN_PROMPTS.find((t) => t.id === id);
}

/** Find the first built-in template matching a category. */
export function getBuiltinByCategory(
    category: PromptCategory,
): PromptTemplate | null {
    return BUILTIN_PROMPTS.find((t) => t.category === category) ?? null;
}
