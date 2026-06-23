/**
 * SillyTavern 原生弹窗适配
 *
 * 仅做 host 调用与类型收窄；弹窗 UI 由 ST 本身渲染。
 */

import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";


export type PopupType = "text" | "confirm" | "input";

/**
 * 调用 SillyTavern 原生弹窗
 * @param content 弹窗内容 (HTML)
 * @param type 弹窗类型 ('text', 'confirm', 'input')
 * @param inputValue 输入框默认值
 * @returns confirm → boolean, input → string, text → null；
 *          ST 不可用时 confirm 视为 true，其余返回 null。
 */
export async function callPopup(
    content: string,
    type: PopupType = "text",
    inputValue: string = "",
): Promise<boolean | string | null> {
    const fn = (window as unknown as {
        callPopup?: (
            content: string,
            type: PopupType,
            value: string,
        ) => Promise<boolean | string | null>;
    }).callPopup;

    if (fn) {
        return fn(content, type, inputValue);
    }

    Logger.warn(LogModule.TAVERN_UI, "callPopup not available");
    return type === "confirm" ? true : null;
}
