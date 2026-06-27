import { useReviewStore } from "@/state/reviewStore.ts";

export type ReviewAction = "confirm" | "fill" | "reject" | "reroll" | "cancel";

/**
 * 审查类型，决定 ReviewContainer 渲染哪个子组件：
 *   - combined → CombinedReview（摘要 + 实体并列）
 *   - entity   → EntityReview
 *   - summary  → SummaryReview
 *   - text     → MessageReview（默认回退）
 */
export type ReviewType = "text" | "entity" | "summary" | "combined";

export interface ReviewRequest {
    id: string; // V1.3.1: Unique ID for multi-tab support
    title: string;
    description: string;
    content: string; // Fallback text
    type?: ReviewType; // V1.2
    data?: any; // Structured data for specialized views
    actions?: ReviewAction[];
    onResult: (result: ReviewResult) => void;
}

export interface ReviewResult {
    action: ReviewAction;
    content: string;
    feedback?: string;
    data?: any;
}

/**
 * ReviewService - 负责处理内容审查请求
 *
 * 解耦 UI (Modal) 和 业务逻辑 (Summarizer)
 */
class ReviewService {
    /**
     * 请求用户审查内容
     */
    public async requestReview(
        title: string,
        description: string,
        content: string,
        actions: ReviewAction[] = ["confirm"],
        type: ReviewType = "text",
        data?: any,
    ): Promise<ReviewResult> {
        return new Promise((resolve) => {
            const id = Date.now().toString(36) +
                Math.random().toString(36).slice(2, 5);
            useReviewStore.getState().enqueue({
                actions,
                content,
                data,
                description,
                id,
                onResult: (result) => resolve(result),
                title,
                type,
            });
        });
    }
}

export const reviewService = new ReviewService();
