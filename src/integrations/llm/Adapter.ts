import { getSettings } from "@/config/settings.ts";
import type { LLMPreset } from "@/config/types/llm.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { regexProcessor } from "@/domain/regex/RegexProcessor.ts";
import { getTavernHelper, type TavernHelper } from "@/sillytavern/context.ts";
import {
    type CustomApiConfig,
    RolePrompt,
} from "@/types/vendor/jsr-function.d.ts";

/** LLM 生成请求 */
interface LLMRequest {
    /** 系统提示词 */
    systemPrompt: string;
    /** 用户提示词 */
    userPrompt: string;
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
            // 获取预设配置：使用全局选中的预设
            const settings = getSettings();

            if (settings.apiSettings?.selectedPresetId) {
                preset = settings.apiSettings?.llmPresets?.find((p) =>
                    p.id === settings.apiSettings?.selectedPresetId
                );
            }

            // 统一提取预设中的参数配置
            const customApiConfig = preset
                ? this.extractPresetParameters(preset)
                : undefined;

            return await this.callTavernHelper(
                request,
                helper,
                customApiConfig,
                preset,
            );
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
        if (preset.source === "custom" && preset.custom) {
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
        customApiConfig?: CustomApiConfig,
        currentPreset?: LLMPreset,
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

        // V1.5 获取此请求所用的 Preset (由 executeRequest 传递进来，或者回退到默认)
        if (!currentPreset) {
            const settings = getSettings();
            currentPreset = settings.apiSettings?.llmPresets?.find((p) =>
                p.id === settings.apiSettings?.selectedPresetId
            );
        }

        const generationOptions = {
            should_stream: currentPreset?.stream ?? false, // 释放底层硬编码
            should_silence: true, // V0.9.1: 后台请求静默，不绑定停止按钮
        };

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
            custom_api: customApiConfig,
            ordered_prompts: prompts,
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
}

/** 默认实例 */
export const llmAdapter = new LLMAdapter();
