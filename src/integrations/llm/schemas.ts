/**
 * Pipeline output schemas + structured-output shape builders.
 *
 * Each extraction pipeline (summary / trim / entity) declares the JSON shape
 * its parser already expects, as a Zod schema. `z.toJSONSchema()` (Zod 4)
 * derives the JSON Schema that the host layer (`generateRaw({ json_schema })`)
 * hands to the provider for constrained decoding.
 *
 * The pipeline declares intent via a `ResponseShape`; the adapter decides
 * whether/how to enforce it based on the active preset's `structuredOutput`
 * setting (off / json_object / json_schema). See Adapter.ts.
 *
 * These Zod definitions mirror the `<output_template>` blocks documented in
 * src/integrations/llm/prompts/*.txt — keep them in sync when editing either.
 */

import { z } from "zod";
import type { JsonSchema } from "@/types/vendor/jsr-function.d.ts";

// ============================================================================
// Zod output schemas
// ============================================================================

/** Event metadata block shared by summary + trim. Matches `EventNode.structured_kv`. */
const metaSchema = z.object({
    time_anchor: z.string(),
    role: z.array(z.string()),
    location: z.array(z.string()),
    event: z.string(),
    logic: z.array(z.string()),
    causality: z.string(),
});

/** Summary / trim output: `{ events: [...] }`. */
const eventOutputSchema = z.object({
    events: z.array(
        z.object({
            summary: z.string(),
            meta: metaSchema,
            significance_score: z.number().min(0).max(1),
        }),
    ),
});

/** Entity extraction output: RFC-6902 JSON Patch rooted at `/entities/{name}`. */
const entityOutputSchema = z.object({
    patches: z.array(
        z.object({
            op: z.enum(["add", "replace", "remove", "copy", "move", "test"]),
            path: z.string(),
            // RFC-6902 `value` is polymorphic (entity objects, scalars, arrays) —
            // cannot be strict-closed. Accept anything when present.
            value: z.any().optional(),
            from: z.string().optional(),
        }),
    ),
});

// ============================================================================
// ResponseShape
// ============================================================================

/**
 * A pipeline's structured-output intent. Carried opaquely through `runLlm` /
 * `LLMRequest`; the adapter reads `jsonSchema` only when the active preset
 * enables `json_schema`.
 */
export interface ResponseShape {
    /** Vendor `JsonSchema`, passed to `generateRaw({ json_schema })`. */
    jsonSchema: JsonSchema;
}

/**
 * Wrap a Zod schema as a vendor `JsonSchema`. Strips the `$schema` draft URL
 * (metadata, not a constraint — some providers reject unknown root keywords).
 */
function toResponseShape(
    name: string,
    schema: z.core.$ZodType,
    strict: boolean,
): ResponseShape {
    const value = z.toJSONSchema(schema) as Record<string, unknown>;
    delete value.$schema;
    return { jsonSchema: { name, value, strict } };
}

/** Summary output shape — closed/strict. */
export function summaryResponseShape(): ResponseShape {
    return toResponseShape("EngramSummary", eventOutputSchema, true);
}

/** Trim output shape — closed/strict (same event shape as summary). */
export function trimResponseShape(): ResponseShape {
    return toResponseShape("EngramTrim", eventOutputSchema, true);
}

/** Entity patch output shape — non-strict (`value` is open-ended). */
export function entityResponseShape(): ResponseShape {
    return toResponseShape("EngramEntityPatches", entityOutputSchema, false);
}
