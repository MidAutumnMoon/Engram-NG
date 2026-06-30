import { getSettings } from "@/config/settings.ts";
import type { LLMPreset } from "@/config/types/llm.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { regexProcessor } from "@/domain/regex/RegexProcessor.ts";
import { getTavernHelper, type TavernHelper } from "@/sillytavern/context.ts";
import {
    type CustomApiConfig,
    type JsonSchema,
    RolePrompt,
} from "@/types/vendor/jsr-function.d.ts";
import type { ResponseShape } from "@/integrations/llm/schemas.ts";

/** LLM 生成请求 */
interface LLMRequest {
    /** 系统提示词 */
    systemPrompt: string;
    /** 用户提示词 */
    userPrompt: string;
    /**
     * 该调用期望的结构化输出形状。仅当预设 `structuredOutput === "json_schema"` 时，
     * adapter 才会据此向 generateRaw 注入 json_schema。
     * 不声明形状的调用（未来非 JSON 用途）不受影响。
     */
    responseShape?: ResponseShape;
}

/** LLM 生成响应 */
interface LLMResponse {
    /** 生成内容 */
    content: string;
    /** 是否成功 */
    success: boolean;
    /** 错误信息 */
    error?: string;
    /** Token 使用量 */
    tokenUsage?: {
        prompt: number;
        completion: number;
        total: number;
    };
}

/** 队列中的请求项 */
interface QueuedRequest {
    request: LLMRequest;
    resolve: (value: LLMResponse) => void;
    reject: (reason: unknown) => void;
}

/**
 * LLMAdapter 类
 * 封装 LLM 调用，支持队列和锁机制
 */
class LLMAdapter {
    /** 执行锁 */
    private isExecuting = false;

    /** 请求队列 */
    private requestQueue: QueuedRequest[] = [];

    /**
     * 进行中的生成（generationId → 开始时间）。
     * 用于超时中止与 reset()：底层 generateRaw 不返回时，可据此中止 ST 侧的僵尸请求。
     */
    private activeGenerations = new Map<string, { startedAt: number }>();

    /**
     * 调用 LLM 生成 (队列模式)
     * @param request 请求参数
     */
    async generate(request: LLMRequest): Promise<LLMResponse> {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ reject, request, resolve });
            this.processQueue();
        });
    }

    /**
     * 处理请求队列
     */
    private async processQueue(): Promise<void> {
        if (this.isExecuting || this.requestQueue.length === 0) {
            return;
        }

        this.isExecuting = true;
        const { request, resolve, reject } = this.requestQueue.shift()!;

        try {
            const result = await this.executeRequest(request);
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.isExecuting = false;
            // 递归处理下一个请求
            this.processQueue();
        }
    }

    /**
     * 执行单个请求
     */
    private async executeRequest(request: LLMRequest): Promise<LLMResponse> {
        const helper = getTavernHelper();

        if (!helper?.generateRaw) {
            return {
                content: "",
                error: "TavernHelper 不可用",
                success: false,
            };
        }

        let preset: LLMPreset | undefined;
        try {
            preset = this.resolveActivePreset();

            // 统一提取预设中的参数配置（含 custom 源完整性校验）
            const customApiConfig = this.extractPresetParameters(preset);

            // 生成唯一 generationId，用于超时中止与 reset()
            const generationId = crypto.randomUUID?.() ??
                `engram-${Date.now()}-${Math.random()}`;

            // 超时保护：底层 generateRaw 不返回时不能让队列永久卡死
            const timeoutMs = LLM_REQUEST_TIMEOUT_MS;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new Error(
                                `LLM 生成超时 (${timeoutMs / 1000}s)`,
                            ),
                        ),
                    timeoutMs,
                );
            });

            try {
                this.activeGenerations.set(generationId, {
                    startedAt: Date.now(),
                });
                return await Promise.race([
                    this.callTavernHelper(
                        request,
                        helper,
                        customApiConfig,
                        preset,
                        generationId,
                    ),
                    timeout,
                ]);
            } catch (error) {
                // 尽力中止底层 ST 生成，避免它继续在后台消耗 token
                try {
                    helper.stopGenerationById?.(generationId);
                } catch {
                    // 中止失败不掩盖原始错误
                }
                throw error;
            } finally {
                if (timer) clearTimeout(timer);
                this.activeGenerations.delete(generationId);
            }
        } catch (error) {
            const errorMsg = error instanceof Error
                ? error.message
                : String(error);
            const presetLabel = preset?.name ?? "default";
            Logger.error(
                LogModule.LLM_ADAPTER,
                `调用失败 (preset: '${presetLabel}')`,
                error,
            );

            return {
                content: "",
                error: errorMsg,
                success: false,
            };
        }
    }

    /**
     * 解析当前选中的 LLM 预设。
     *
     * 严格策略：selectedPresetId 必须非空且指向一个存在的预设，否则抛错。
     * 这避免了「未选预设时悄悄回退到 ST 当前连接」这一隐性行为——
     * 用户应在服务页明确选择一个预设。
     */
    private resolveActivePreset(): LLMPreset {
        const settings = getSettings();
        const selectedId = settings.apiSettings?.selectedPresetId;
        if (!selectedId) {
            throw new Error(
                "未选择 LLM 预设：请在服务页选中一个预设后再发起生成。",
            );
        }
        const preset = settings.apiSettings?.llmPresets?.find((p) =>
            p.id === selectedId
        );
        if (!preset) {
            throw new Error(
                `选中的预设 (id='${selectedId}') 已被删除；请在服务页重新选择。`,
            );
        }
        return preset;
    }

    // =========================================================================
    // 执行路径：custom (自定义 API)
    // =========================================================================

    // =========================================================================
    // 助手方法：提取预设参数
    // =========================================================================

    private extractPresetParameters(preset: LLMPreset): CustomApiConfig {
        // 采样参数。这些字段 CustomApiConfig 接受 'same_as_preset' | 'unset' | number，
        // 而 preset.parameters 里都是 number，直接赋值即可。
        // max_context 故意不放进来：JS-Slash-Runner 运行时从不读 custom_api.max_context，
        // 它自行用 getMaxContextSize() 计算，放进来是死写字段。
        const config: CustomApiConfig = {
            frequency_penalty: preset.parameters?.frequencyPenalty,
            max_tokens: preset.parameters?.maxTokens,
            presence_penalty: preset.parameters?.presencePenalty,
            temperature: preset.parameters?.temperature,
            top_k: preset.parameters?.topK,
            top_p: preset.parameters?.topP,
        };

        // 移除 undefined 项，避免覆盖酒馆默认值
        for (const key of Object.keys(config) as (keyof CustomApiConfig)[]) {
            if (config[key] === undefined) {
                delete config[key];
            }
        }

        // 如果是 custom，额外添加连接信息
        if (preset.source === "custom") {
            // 自定义源必须有可用端点；否则会静默落到 ST 当前连接，行为难以诊断
            if (!preset.custom?.apiUrl || !preset.custom?.model) {
                throw new Error(
                    "自定义预设缺少 apiUrl/model，请在服务页补全后再使用。",
                );
            }
            config.apiurl = preset.custom.apiUrl;
            config.key = preset.custom.apiKey;
            config.model = preset.custom.model;
            config.source = "openai";
            // stream 不放进来：流式由顶层 GenerateConfig.should_stream 控制
            // （已在 callTavernHelper 的 generationOptions 里传），运行时不读 custom_api.stream。
        } else if (preset.modelOverride) {
            // 如果是非 custom 预设但指定了模型名，也强制覆盖
            config.model = preset.modelOverride;
        }

        return config;
    }

    // =========================================================================
    // 核心调用逻辑
    // =========================================================================

    private async callTavernHelper(
        request: LLMRequest,
        helper: NonNullable<TavernHelper>,
        customApiConfig: CustomApiConfig | undefined,
        currentPreset: LLMPreset,
        generationId: string,
    ): Promise<LLMResponse> {
        // =========================================================================
        // Prompt Pre-processing (V1.0 Fix)
        // =========================================================================
        const finalSystemPrompt = request.systemPrompt || "";
        let finalUserPrompt = request.userPrompt || "";

        // Engram Pipeline (RegexProcessor)
        finalUserPrompt = regexProcessor.process(finalUserPrompt, "input");

        // =========================================================================
        // 调用 TavernHelper
        // =========================================================================

        const generationOptions = {
            should_stream: currentPreset.stream ?? false, // 释放底层硬编码
            should_silence: true, // V0.9.1: 后台请求静默，不绑定停止按钮
        };

        // ---- 结构化输出注入（off 时完全跳过，行为同前） ----
        // 形状由流水线声明（LLMRequest.responseShape），模式由预设决定。
        // 仅剩 json_schema：generateRaw 原生支持，JSR 按 provider 自动转换
        //   （OpenAI/DeepSeek/Mistral → response_format.json_schema；Claude → forced tool）。
        //   不支持的 provider 会被 ST 服务端静默丢弃并告警，回退 prompt-only。
        let jsonSchemaArg: JsonSchema | undefined;
        const mode = currentPreset.structuredOutput ?? "off";
        if (mode === "json_schema" && request.responseShape) {
            jsonSchemaArg = request.responseShape.jsonSchema;
        }

        let content: string;

        const prompts: RolePrompt[] = [];

        // 严格遵循：System -> User 顺序
        if (finalSystemPrompt) {
            prompts.push({ content: finalSystemPrompt, role: "system" });
        }

        // 直接将用户内容作为 user 角色推入，不再使用 'user_input' 占位符
        // 这样酒馆就不会在末尾自动追加多余的内容
        prompts.push({ content: finalUserPrompt, role: "user" });

        // generateRaw 不走酒馆当前预设，直接以 ordered_prompts 作为提示词，
        // 这正是 Engram 自定义 prompt 所需的语义。
        // 返回值在传入 tools 时会是 GenerateToolCallResult，Engram 从不传 tools，
        // 故此处只可能是 string；做一次归一化以防万一。
        const result = await helper.generateRaw({
            generation_id: generationId,
            custom_api: customApiConfig,
            ordered_prompts: prompts,
            json_schema: jsonSchemaArg,
            ...generationOptions,
        });
        content = typeof result === "string" ? result : result.content;

        // V1.5.5: TavernHelper 不返回 token 用量，这里用本地估算兜底
        const estimatedPromptTokens = this.estimateTokens(
            finalSystemPrompt + finalUserPrompt,
        );
        const estimatedCompletionTokens = this.estimateTokens(content);

        return {
            content: content || "",
            success: true,
            tokenUsage: {
                completion: estimatedCompletionTokens,
                prompt: estimatedPromptTokens,
                total: estimatedPromptTokens + estimatedCompletionTokens,
            },
        };
    }

    /**
     * 估算文本 Token 数（简单估算）
     * @param text 文本
     */
    estimateTokens(text: string): number {
        return Math.ceil(text.length / 3);
    }

    /**
     * 获取队列长度 (调试用)
     */
    getQueueLength(): number {
        return this.requestQueue.length;
    }

    /**
     * 是否正在执行 (调试用)
     */
    isBusy(): boolean {
        return this.isExecuting;
    }

    /**
     * 强制重置：清空队列、释放执行锁、尽力中止所有进行中的底层生成。
     *
     * 用于底层 generateRaw 不返回（队列卡死）或需要紧急中断时的恢复路径。
     * 排队中的请求会被 reject，调用方（runLlm）会看到错误。
     */
    reset(): void {
        const helper = getTavernHelper();
        for (const id of this.activeGenerations.keys()) {
            try {
                helper?.stopGenerationById?.(id);
            } catch {
                // 单条中止失败不阻断其余清理
            }
        }
        this.activeGenerations.clear();

        const queued = this.requestQueue.splice(0);
        for (const { reject } of queued) {
            try {
                reject(new Error("LLM adapter 已重置"));
            } catch {
                // 调用方的 reject 回调抛错不应阻断其余 reject
            }
        }
        this.isExecuting = false;
    }
}

/**
 * 单次 LLM 请求的硬超时。底层 generateRaw 卡住时强制中止，避免队列永久停滞。
 * 5 分钟覆盖绝大多数长上下文摘要/精简生成。
 */
const LLM_REQUEST_TIMEOUT_MS = 300_000;

/** 默认实例 */
export const llmAdapter = new LLMAdapter();
