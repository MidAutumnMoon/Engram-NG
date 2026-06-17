/**
 * 全局类型声明
 *
 * 扩展 Window 接口，为 SillyTavern 全局 API 提供类型提示
 */


declare global {
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

        /**
         * TavernHelper API (酒馆助手扩展提供)
         */
        TavernHelper?: {
            createWorldbook?: (name: string) => Promise<void>;
            getWorldbook?: (name: string) => Promise<unknown[]>;
            saveWorldbook?: (name: string) => Promise<void>;
            getCharWorldbookNames?: (mode: 'current' | 'all') => {
                primary?: string;
                additional: string[];
            } | null;
            rebindCharWorldbooks?: (
                mode: 'current',
                books: { primary?: string; additional: string[] }
            ) => Promise<void>;
            formatAsTavernRegexedString?: (
                text: string,
                placement: string, // 'ai_output' | 'user_input' etc
                options?: { isPrompt: boolean }
            ) => string;
        };
    }
}
