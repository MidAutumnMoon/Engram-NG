import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";

const DEFAULTS: ToastrOptions = {
    closeButton: true,
    extendedTimeOut: 1000,
    progressBar: true,
    timeOut: 5000,
};

/** Fire-and-forget toast. Falls back to console if toastr is unavailable. */
export function toast(
    level: "success" | "info" | "warning" | "error",
    message: string,
    title = "Engram",
    opts?: ToastrOptions,
): void {
    if (window.toastr) {
        window.toastr[level](message, title, { ...DEFAULTS, ...opts });
    } else {
        console.log(`[Engram] ${level}: ${title} - ${message}`);
    }
    Logger[level === "warning" ? "warn" : level](
        LogModule.NOTIFICATION,
        message,
    );
}

/** Show a persistent toast with an optional cancel button. Returns a handle for later removal. */
export function toastPersistent(
    message: string,
    title = "Engram",
    onCancel?: () => void,
): JQuery | null {
    const t = window.toastr;
    if (!t) {
        console.log(`[Engram] running: ${title} - ${message}`);
        return null;
    }
    const display = onCancel
        ? `${message} <small style="opacity:0.7">(点击取消)</small>`
        : message;

    const handle: JQuery = t.info(display, title, {
        timeOut: 20_000,
        extendedTimeOut: 0,
        closeButton: false,
        progressBar: true,
        tapToDismiss: false,
        escapeHtml: false,
        onclick: onCancel
            ? () => {
                Logger.info(LogModule.NOTIFICATION, "用户取消操作");
                t.remove(handle);
                onCancel();
            }
            : undefined,
    });
    return handle;
}

/** Remove a persistent toast by its handle. */
export function dismissToast(handle: JQuery | null): void {
    if (window.toastr && handle) window.toastr.remove(handle);
}
