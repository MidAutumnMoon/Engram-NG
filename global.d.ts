/// <reference types="vite/client" />
/// <reference types="npm:@types/jquery" />
/// <reference types="@/types/type-fest-global.d.ts" />
/// <reference types="./vendor/JS-Slash-Runner/@types/iframe/exported.sillytavern.d.ts" />
/// <reference types="@/types/vendor/jsr-function.d.ts" />
/// <reference types="./vendor/JS-Slash-Runner/@types/iframe/exported.mvu.d.ts" />
/// <reference types="./vendor/JS-Slash-Runner/@types/iframe/exported.ejstemplate.d.ts" />
/// <reference types="./vendor/JS-Slash-Runner/@types/iframe/event.d.ts" />

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
     * SillyTavern host object. Present before any extension script executes (verified by reading SillyTavern's source code).
     */
    SillyTavern: { getContext: () => typeof SillyTavern };

    /**
     * JS-Slash-Runner 可选插件，仅在用户安装后存在。
     * 类型来自 vendor/JS-Slash-Runner/@types/iframe/，通过 ambient `declare const` 引用。
     */
    Mvu?: typeof Mvu;
    EjsTemplate?: typeof EjsTemplate;
}
