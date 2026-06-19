/// <reference types="vite/client" />
/// <reference types="./vendor/JS-Slash-Runner/@types/iframe/exported.sillytavern.d.ts" />
/// <reference types="./src/types/vendor/jsr-function.d.ts" />
/// <reference types="./vendor/JS-Slash-Runner/@types/iframe/exported.mvu.d.ts" />
/// <reference types="./vendor/JS-Slash-Runner/@types/iframe/exported.ejstemplate.d.ts" />

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
     * SillyTavern 事件源
     */
    eventSource: EventTarget;

    /**
     * 酒馆宿主对象，扩展加载时必然存在。
     * `getContext()` 返回类型复用 JS-Slash-Runner 的 `declare const SillyTavern`（即 ST 上下文形状），
     * 因此无需手写 context 接口。
     */
    SillyTavern: { getContext: () => typeof SillyTavern };

    /**
     * SillyTavern power_user 全局配置（仅声明 src/ 实际使用的字段）。
     */
    power_user?: { persona_description?: string };

    /**
     * JS-Slash-Runner 可选插件，仅在用户安装后存在。
     * 类型来自 vendor/JS-Slash-Runner/@types/iframe/，通过 ambient `declare const` 引用。
     */
    Mvu?: typeof Mvu;
    EjsTemplate?: typeof EjsTemplate;
}
