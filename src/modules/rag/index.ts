/**
 * RAG 服务模块导出
 */

export {
    EmbeddingService,
    embeddingService,
} from "./embedding/EmbeddingService";
export { type RetrievalResult, retriever } from "./retrieval/Retriever";
export { rerankService as reranker } from "./retrieval/Reranker";
export { injector as injectionService } from "./injection/Injector";
// REFERENCE: BrainRecallCache removed from hot path.
// Export kept for backward compat if external code imports it.
export {
    BrainRecallCache,
    brainRecallCache,
} from "./retrieval/BrainRecallCache";
