/// <reference types="vite/client" />
/// <reference types="./vendor/SillyTavern/public/global.d.ts" />
/// <reference types="./vendor/JS-Slash-Runner/@types/function/index.d.ts" />

/**
 * 全局类型声明
 *
 * 扩展 Window 接口，为 SillyTavern 全局 API 提供类型提示
 */

interface Window {
    /**
     * 当前选择的模型名称
     */
    selected_model?: string;

    /**
     * JQuery (由 SillyTavern 提供)
     */
    jQuery: JQuery;
    $: JQuery;

    /**
     * SillyTavern 事件源
     */
    eventSource: EventTarget;
}
