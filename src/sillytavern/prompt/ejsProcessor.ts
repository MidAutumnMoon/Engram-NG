import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";

/**
 * Render an array of strings through ST-Prompt-Template's EJS engine,
 * merging MVU variables into context when available.
 *
 * No-ops (returns the input unchanged) when ST-Prompt-Template isn't loaded.
 */
export async function processEjs(entries: string[]): Promise<string[]> {
    console.warn(
        "processEjs debug",
        typeof EjsTemplate,
        typeof window.EjsTemplate,
    );
    if (entries.length === 0) return entries;

    // const { EjsTemplate, Mvu } = window;

    // Check if ST-Prompt-Template is available
    if (!EjsTemplate) {
        Logger.debug(
            LogModule.EJS_PROCESSOR,
            "ST-Prompt-Template 未检测到，跳过 EJS 处理",
        );
        return entries;
    }

    try {
        // 1. 准备上下文 (自动包含 {{user}}, {{char}} 及所有酒馆变量)
        const context = await EjsTemplate.prepareContext();

        // 2. 尝试获取 MVU 变量并合并
        if (Mvu !== undefined && Mvu.getMvuData) {
            try {
                const mvuObj = Mvu.getMvuData({
                    message_id: "latest",
                    type: "message",
                });
                if (mvuObj && mvuObj.stat_data) {
                    context.mvu = mvuObj.stat_data;
                }
            } catch (error) {
                Logger.warn(
                    LogModule.EJS_PROCESSOR,
                    "获取 MVU 数据失败",
                    error,
                );
            }
        }

        // 3. 逐条渲染
        const processed = await Promise.all(entries.map(async (content) => {
            try {
                return await EjsTemplate.evaltemplate(content, context);
            } catch (error) {
                Logger.warn(
                    LogModule.EJS_PROCESSOR,
                    "EJS 渲染单条失败，保留原内容",
                    error,
                );
                return content;
            }
        }));

        return processed;
    } catch (error) {
        Logger.warn(LogModule.EJS_PROCESSOR, "EJS 预处理失败", error);
        return entries;
    }
}
