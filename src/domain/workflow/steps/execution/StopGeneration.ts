import type { IStep } from "../../core/Step.ts";
import type { JobContext } from "../../core/JobContext.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { getSTContext } from "@/sillytavern/index.ts";

/**
 * 停止 SillyTavern 生成
 * 可作为工作流步骤使用，也可直接调用静态方法
 */
export class StopGeneration implements IStep {
    name = "StopGeneration";

    async execute(context: JobContext): Promise<void> {
        Logger.info(LogModule.SYSTEM, "执行 StopGeneration 步骤");
        await StopGeneration.abort();
    }

    /**
     * 静态方法：直接终止生成
     */
    static abort(): void {
        try {
            // 路径 1: 使用官方 Context 接口 (Engram 集成层)
            const stCtx = getSTContext();
            if (stCtx.stopGeneration) {
                stCtx.stopGeneration();
                Logger.info(
                    LogModule.SYSTEM,
                    "通过 ST Context 成功调用 stopGeneration",
                );
                return;
            }

            // 路径 2: 暴力模拟 UI 点击 (最后的兜底，只要按钮在 DOM 中就有效)
            const stopButton = document.querySelector(
                "#mes_stop",
            ) as HTMLButtonElement | null;

            if (stopButton && stopButton.offsetParent !== null) {
                stopButton.click();
                Logger.info(
                    LogModule.SYSTEM,
                    "通过模拟点击 #mes_stop 按钮触发中断",
                );
                return;
            }

            Logger.warn(
                LogModule.SYSTEM,
                "未找到有效的 StopGeneration 触发路径",
            );
        } catch (error) {
            Logger.warn(
                LogModule.SYSTEM,
                "调用 stopGeneration 过程中发生致命错误",
                error,
            );
        }
    }
}
