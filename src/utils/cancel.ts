/**
 * A minimal cooperative-cancellation primitive shared across pipelines
 * (LLM requests, embedding batches).
 *
 * Caller holds the object and flips `cancelled` to true; the running task
 * polls via {@link isCancelled} and bails out.
 */

export type CancelSignal = { cancelled: boolean };

/** True if the caller has requested cancellation. */
export function isCancelled(signal?: CancelSignal): boolean {
    return Boolean(signal?.cancelled);
}
