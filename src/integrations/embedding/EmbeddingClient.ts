import type { VectorConfig } from "@/config/types/rag.ts";

/**
 * 嵌入 API 响应 (OpenAI 格式)
 */
interface OpenAIEmbeddingResponse {
    data: {
        embedding: number[];
        index: number;
    }[];
    model: string;
    usage?: {
        prompt_tokens: number;
        total_tokens: number;
    };
}

/**
 * OpenAI 官方端点（source === "openai" 且 apiUrl 为空时使用）。
 */
const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com/v1/embeddings";

/**
 * 嵌入客户端
 *
 * Engram 仅使用 OpenAI 兼容嵌入协议：`custom` 源走用户填写的端点，
 * `openai` 源缺省走 OpenAI 官方端点。二者请求/响应格式完全一致。
 */
export class EmbeddingClient {
    /**
     * 根据配置调用 OpenAI 兼容嵌入 API。
     */
    static async callAPI(
        text: string,
        config: VectorConfig,
    ): Promise<number[]> {
        let endpoint = config.apiUrl;
        if (!endpoint) {
            if (config.source === "openai") {
                endpoint = DEFAULT_OPENAI_ENDPOINT;
            } else {
                throw new Error("API endpoint not configured");
            }
        }

        // 清理末尾斜杠
        endpoint = endpoint.replace(/\/+$/, "");

        // V0.9.9: 根据 autoSuffix 配置决定是否自动添加后缀
        // 默认 autoSuffix = true，除非用户明确关闭
        // 只补 /embeddings，用户需填写带 /v1 的完整 base URL
        if (config.autoSuffix !== false) {
            // 仅当 URL 不包含 /embeddings 时才添加
            if (!endpoint.includes("/embeddings")) {
                endpoint = `${endpoint}/embeddings`;
            }
        }

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        if (config.apiKey) {
            headers["Authorization"] = `Bearer ${config.apiKey}`;
        }

        const body: Record<string, any> = {
            input: text,
            model: config.model || "text-embedding-3-small",
        };

        // 可选: 指定维度 (OpenAI text-embedding-3 支持)
        if (config.dimensions) {
            body.dimensions = config.dimensions;
        }

        try {
            const response = await fetch(endpoint, {
                body: JSON.stringify(body),
                headers,
                method: "POST",
            });

            if (!response.ok) {
                const errorText = await response.text();
                // 增强错误信息，包含请求 URL
                throw new Error(
                    `API error ${response.status} at ${endpoint}: ${errorText}`,
                );
            }

            const data = await response.json() as OpenAIEmbeddingResponse;
            if (!data.data || data.data.length === 0) {
                throw new Error("No embedding data returned");
            }

            return data.data[0].embedding;
        } catch (error: any) {
            // 再次捕获以确保 URL 信息暴露
            if (!error.message.includes("at http")) {
                throw new Error(
                    `Request to ${endpoint} failed: ${error.message}`,
                    { cause: error },
                );
            }
            throw error;
        }
    }
}
