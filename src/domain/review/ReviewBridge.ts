import type { EntityNode } from "@/data/types/graph.ts";
import { useReviewStore } from "@/state/reviewStore.ts";

export type ReviewAction = "confirm" | "fill" | "reject" | "reroll" | "cancel";

/**
 * 审查类型，决定 ReviewContainer 渲染哪个子组件：
 *   - text     → MessageReview（默认回退，支持 query 编辑）
 *   - entity   → EntityReview
 *   - summary  → SummaryReview
 *   - combined → CombinedReview（摘要 + 实体并列）
 */
export type ReviewType = "text" | "entity" | "summary" | "combined";

// ==================== Per-type payloads ====================

/** Entity section payload (entity / combined reviews). */
export interface EntityReviewData {
    newEntities: EntityNode[];
    updatedEntities: EntityNode[];
    error?: string;
}

/** Summary section payload (summary reviews). */
export interface SummaryReviewData {
    /** Parsed event list, if available; otherwise `content` carries raw text. */
    events?: string[];
    /** Query slot used by MessageReview-style prompts. */
    query?: string;
}

/** Combined review payload — summary + entity sections in one modal. */
export interface CombinedReviewData {
    summaryContent?: string;
    summaryData?: SummaryReviewData;
    entityData?: {
        newEntities?: EntityNode[];
        updatedEntities?: EntityNode[];
    };
}

// ==================== Request type ====================

/** Union of all per-type data payloads. */
export type ReviewData =
    | { query?: string }
    | EntityReviewData
    | SummaryReviewData
    | CombinedReviewData;

/**
 * A review request. `data` is the loose union (the store is a polymorphic
 * bag); callers get tighter per-type data via the generic `requestReview<T>`,
 * and the UI narrows by switching on `type` at runtime.
 */
export interface ReviewRequest {
    id: string;
    title: string;
    description: string;
    content: string;
    type?: ReviewType;
    data?: ReviewData;
    actions?: ReviewAction[];
    onResult: (result: ReviewResult) => void;
}

/** Maps a review type to the data shape that flows in and out of it. */
export interface ReviewDataOfType {
    text: { query?: string };
    entity: EntityReviewData;
    summary: SummaryReviewData;
    combined: CombinedReviewData;
}

export interface ReviewResult<T extends ReviewType = ReviewType> {
    action: ReviewAction;
    content: string;
    feedback?: string;
    data?: ReviewDataOfType[T];
}

// ==================== Request API ====================

export interface RequestReviewOptions<T extends ReviewType> {
    title: string;
    description: string;
    /** Fallback / raw text content shown by the text view. */
    content: string;
    actions?: ReviewAction[];
    type?: T;
    /** Structured payload for specialized views; shape must match `type`. */
    data?: ReviewDataOfType[T];
}

/**
 * Request a user review and resolve with the user's action.
 *
 * Decouples the business logic (pipelines / ingestion) from the React modal:
 * enqueues into the review store, the ReviewContainer renders the matching
 * view, and the user's action resolves the returned promise. The result's
 * `data` is typed per the requested `type`.
 */
export function requestReview<T extends ReviewType = "text">(
    opts: RequestReviewOptions<T>,
): Promise<ReviewResult<T>> {
    const { title, description, content, actions, type, data } = opts;
    return new Promise((resolve) => {
        const id = Date.now().toString(36) +
            Math.random().toString(36).slice(2, 5);
        useReviewStore.getState().enqueue({
            actions,
            content,
            data,
            description,
            id,
            onResult: resolve as (result: ReviewResult) => void,
            title,
            type,
        });
    });
}
