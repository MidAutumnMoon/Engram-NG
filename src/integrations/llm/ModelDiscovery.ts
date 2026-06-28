/**
 * ModelService - 模型列表获取服务
 *
 * 仅保留 OpenAI 兼容协议的模型列表抓取：LLM 预设、向量源、Rerank 三处的
 * 「获取模型列表」按钮都走它。非 OpenAI 兼容源（ollama/vllm/jina/voyage/
 * transformers）已随多源设计一同退役。
 */

import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { getRequestHeaders } from "@/sillytavern/context.ts";

/**
 * 模型信息
 */
export interface ModelInfo {
    id: string;
    name?: string;
    contextLength?: number;
    owned_by?: string;
}

/**
 * 获取模型配置
 */
export interface FetchModelsConfig {
    apiUrl: string;
    apiKey?: string;
    timeout?: number;
}

export class ModelService {
    private static readonly DEFAULT_TIMEOUT = 10_000; // 10秒

    /**
     * 获取 OpenAI 兼容 API 的模型列表
     * 适用于: OpenAI, Azure, 自定义 OpenAI 兼容服务
     */
    static async fetchOpenAIModels(
        config: FetchModelsConfig,
    ): Promise<ModelInfo[]> {
        const { apiUrl, apiKey, timeout = this.DEFAULT_TIMEOUT } = config;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            // V1.5: 使用酒馆后端代理获取模型列表，解决 CORS 问题
            // 我们利用 OpenAI 源的 reverse_proxy 逻辑通过后端转发
            const proxyResponse = await fetch(
                "/api/backends/chat-completions/status",
                {
                    body: JSON.stringify({
                        chat_completion_source: "openai",
                        reverse_proxy: apiUrl,
                        proxy_password: apiKey,
                    }),
                    headers: getRequestHeaders(),
                    method: "POST",
                    signal: controller.signal,
                },
            );

            clearTimeout(timeoutId);

            if (!proxyResponse.ok) {
                throw new Error(
                    `HTTP ${proxyResponse.status}: ${proxyResponse.statusText}`,
                );
            }

            const data = await proxyResponse.json();

            // 酒馆后端的返回结构通常是直接透传 API 的响应，或者是包装后的数据
            // 对于 OpenAI 兼容接口，models 列表通常在 data.data 路径下
            const modelsData = data?.data || [];
            const models: ModelInfo[] =
                (Array.isArray(modelsData) ? modelsData : []).map((m: any) => ({
                    id: m.id || m.model,
                    name: m.name || m.id || m.model,
                    owned_by: m.owned_by,
                }));

            Logger.info(
                LogModule.MODEL_SERVICE,
                `Fetched ${models.length} models through Backend Proxy`,
            );
            return models.toSorted((a, b) => a.id.localeCompare(b.id));
        } catch (error: any) {
            if (error.name === "AbortError") {
                Logger.error(
                    LogModule.MODEL_SERVICE,
                    "Backend Proxy request timeout",
                );
            } else {
                Logger.error(
                    LogModule.MODEL_SERVICE,
                    `Backend Proxy error: ${error.message}`,
                );
            }
            throw error;
        }
    }

    /**
     * 获取常用 Rerank 模型列表
     */
    static getCommonRerankModels(): ModelInfo[] {
        return [
            { id: "BAAI/bge-reranker-v2-m3", name: "BGE Reranker v2 m3" },
            { id: "BAAI/bge-reranker-large", name: "BGE Reranker Large" },
            { id: "BAAI/bge-reranker-base", name: "BGE Reranker Base" },
            {
                id: "cross-encoder/ms-marco-MiniLM-L-12-v2",
                name: "MS MARCO MiniLM L12",
            },
            {
                id: "Xenova/ms-marco-MiniLM-L-6-v2",
                name: "MS MARCO MiniLM L6 (ONNX)",
            },
            {
                id: "jinaai/jina-reranker-v2-base-multilingual",
                name: "Jina Reranker v2 Multilingual",
            },
        ];
    }
}
