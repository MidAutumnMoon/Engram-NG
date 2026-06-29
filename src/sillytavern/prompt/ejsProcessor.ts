import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { getEjsTemplate, getMvu } from "@/sillytavern/context.ts";

/**
 * Render an array of strings through ST-Prompt-Template's EJS engine,
 * merging MVU variables into context when available.
 *
 * No-ops (returns the input unchanged) when ST-Prompt-Template isn't loaded.
 */
export async function processEjs(entries: string[]): Promise<string[]> {
    if (entries.length === 0) return entries;

    const ejs = getEjsTemplate();
    const mvu = getMvu();

    try {
        // 1. 准备上下文 (自动包含 {{user}}, {{char}} 及所有酒馆变量)
        const context = await ejs.prepareContext();

        // 2. 尝试获取 MVU 变量并合并
        if (mvu) {
            try {
                const mvuObj = mvu.getMvuData({
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
                return await ejs.evaltemplate(content, context);
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
