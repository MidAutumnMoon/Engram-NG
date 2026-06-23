/// <reference types="vite/client" />
/// <reference types="npm:@types/jquery" />
/// <reference types="npm:@types/toastr" />
/// <reference types="@/types/type-fest-global.d.ts" />
/// <reference types="./vendor/JS-Slash-Runner/@types/iframe/exported.sillytavern.d.ts" />
/// <reference types="@/types/vendor/jsr-function.d.ts" />
/// <reference types="./vendor/JS-Slash-Runner/@types/iframe/exported.mvu.d.ts" />
/// <reference types="./vendor/JS-Slash-Runner/@types/iframe/exported.ejstemplate.d.ts" />
/// <reference types="./vendor/JS-Slash-Runner/@types/iframe/event.d.ts" />

interface Window {
    /**
     * SillyTavern 事件源
     */
    eventSource: EventTarget;

    /**
     * SillyTavern host object. Present before any extension script executes (verified by reading SillyTavern's source code).
     */
    SillyTavern: {
        // deno-lint-ignore-line no-restricted-globals
        // oxlint-disable-next-line no-restricted-globals
        getContext: () => typeof SillyTavern;
        // We do not use libs bundled with SillyTavern.
        lib: unknown;
    };

    /**
     * Toast notification library. Loaded before extension scripts run (verified by reading SillyTavern's source code).
     */
    // deno-lint-ignore-line no-restricted-globals
    // oxlint-disable-next-line no-restricted-globals
    toastr: Toastr;

    // https://github.com/MagicalAstrogy/MagVarUpdate/
    // deno-lint-ignore-line no-restricted-globals
    // oxlint-disable-next-line no-restricted-globals
    Mvu?: typeof Mvu;

    // https://github.com/zonde306/ST-Prompt-Template/
    // deno-lint-ignore-line no-restricted-globals
    // oxlint-disable-next-line no-restricted-globals
    EjsTemplate?: typeof EjsTemplate;
}
