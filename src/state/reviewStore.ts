/**
 * ReviewStore - 审查请求队列的全局状态。
 *
 * Producer（ReviewService，非 React 代码）通过 enqueue 推入请求；
 * Consumer（ReviewContainer，React 组件）订阅 requests 渲染。
 * 这取代了此前用 EventBus 做"邮箱"的间接通信——它本就是应用状态，而非广播。
 */
import { create } from "zustand";
import type { ReviewRequest } from "@/domain/review/ReviewBridge.ts";

interface ReviewState {
    requests: ReviewRequest[];
    /** 推入一条审查请求；同 id 已存在则忽略。 */
    enqueue: (req: ReviewRequest) => void;
    /** 移除一条已结束的请求。 */
    remove: (id: string) => void;
}

export const useReviewStore = create<ReviewState>((set) => ({
    requests: [],
    enqueue: (req) =>
        set((s) =>
            s.requests.some((r) => r.id === req.id)
                ? s
                : { requests: [...s.requests, req] }
        ),
    remove: (id) =>
        set((s) => ({ requests: s.requests.filter((r) => r.id !== id) })),
}));
