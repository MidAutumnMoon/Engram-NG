// Close enough on modern tokenizers.
const MAGIC_TOKEN_CHARS_RATIO = 0.4;

/**
 * Estimates token counts without relying on the SillyTavern.
 */
export function countTokens(text: string): number {
    return Math.ceil(text.length * MAGIC_TOKEN_CHARS_RATIO);
}
