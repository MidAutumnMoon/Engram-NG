/**
 * Regex domain — text-cleaning primitives shared across pipelines, adapters,
 * macros, and the regex-config UI.
 *
 * This module is intentionally free of any workflow-core dependency
 * (no Step / JobContext / WorkflowEngine). Re-exporting from here lets
 * `@/domain/workflow/steps/index.ts` shrink without breaking the many
 * non-workflow consumers that need `regexProcessor` / `RegexRule`.
 */

export {
    DEFAULT_REGEX_RULES,
    RegexProcessor,
    REGEX_SCOPE_OPTIONS,
    regexProcessor,
} from "./RegexProcessor.ts";

export type { RegexRule, RegexScope } from "./RegexProcessor.ts";
