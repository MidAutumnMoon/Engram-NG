/**
 * RAG 服务模块导出
 */

export {
    EmbeddingService,
    embeddingService,
} from "./embedding/EmbeddingService.ts";
export { type RetrievalResult, retriever } from "./retrieval/Retriever.ts";
export { rerankService as reranker } from "./retrieval/Reranker.ts";
export { injector as injectionService } from "./injection/Injector.ts";
// REFERENCE: BrainRecallCache removed from hot path.
// Export kept for backward compat if external code imports it.
export {
    BrainRecallCache,
    brainRecallCache,
} from "./retrieval/BrainRecallCache.ts";
