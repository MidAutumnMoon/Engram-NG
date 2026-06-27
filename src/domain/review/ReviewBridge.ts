import { useReviewStore } from "@/state/reviewStore.ts";

export type ReviewAction = "confirm" | "fill" | "reject" | "reroll" | "cancel";

/**
 * V2.1: 复合审查类型，供统一摄取 pass 使用。
 * 一个 modal 同时展示 summary + entity 两段，每段可独立 mini-action。
 */
export type ReviewType =
    | "text"
    | "json"
    | "entity"
    | "summary"
    | "combined";

/**
 * V2.1: 每段独立的审查结果。让一次 onResult 能表达
 * 「summary 重抽，但 entity 确认」这类组合。
 */
export interface ReviewSectionResult {
    action: ReviewAction;
    content?: string;
    feedback?: string;
    data?: any;
}

export interface ReviewRequest {
    id: string; // V1.3.1: Unique ID for multi-tab support
    title: string;
    description: string;
    content: string; // Fallback text
    type?: ReviewType; // V1.2
    data?: any; // Structured data for specialized views
    actions?: ReviewAction[];
    onResult: (
        result: {
            action: ReviewAction;
            content: string;
            feedback?: string;
            data?: any;
            /** V2.1: 复合审查时，每段的独立结果 */
            sections?: {
                summary?: ReviewSectionResult;
                entity?: ReviewSectionResult;
            };
        },
    ) => void;
}

/**
 * ReviewService - 负责处理内容审查请求
 *
 * 解耦 UI (Modal) 和 业务逻辑 (Summarizer)
 */
class ReviewService {
    /**
     * 请求用户审查内容
     * @returns Promise
     */
    public async requestReview(
        title: string,
        description: string,
        content: string,
        actions: ReviewAction[] = ["confirm"],
        type: ReviewType = "text",
        data?: any,
    ): Promise<{
        action: ReviewAction;
        content: string;
        feedback?: string;
        data?: any;
        sections?: {
            summary?: ReviewSectionResult;
            entity?: ReviewSectionResult;
        };
    }> {
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
