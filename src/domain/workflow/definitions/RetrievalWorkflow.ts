import type { WorkflowDefinition } from "../core/WorkflowEngine.ts";
import { KeywordRetrieveStep } from "../steps/rag/KeywordRetrieveStep.ts";
import { RecordRecallLogStep } from "../steps/rag/RecordRecallLogStep.ts";
import { RerankMergeStep } from "../steps/rag/RerankMergeStep.ts";
import { VectorRetrieveStep } from "../steps/rag/VectorRetrieveStep.ts";

export const createRetrievalWorkflow = (): WorkflowDefinition => ({
    name: "RetrievalWorkflow",
    steps: [
        new KeywordRetrieveStep(), // 优先进行关键词硬扫
        new VectorRetrieveStep(), // 然后进行向量检索
        new RerankMergeStep(), // 合并两者并可选执行 Rerank
        // REFERENCE: BrainRecallStep was removed from the hot path.
        // The algorithm is kept in BrainRecallCache.ts for future review.
        new RecordRecallLogStep(),
    ],
});
