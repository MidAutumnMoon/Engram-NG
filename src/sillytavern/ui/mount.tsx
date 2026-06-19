/**
 * 单一 React 根挂载
 *
 * bootstrap 调一次 mountEngram()：创建 `#engram-root`，createRoot 后渲染 EngramRoot。
 * 没有第二个 createRoot、没有手写的 panel/header/content DOM —— 那些都是 EngramRoot
 * + PanelRoot 的 React 内部细节，由 uiStore.panelOpen 驱动。
 *
 * 原历史实现里 openMainPanel/closeMainPanel/createMainPanel 那一套命令式生命周期
 * （panelVisible / panelElement / reactRoot / unmount）已全部删除：可见性=uiStore 状态。
 */
import { Logger } from "@/logger/index.ts";
import { createRoot } from "react-dom/client";

const MODULE = "TavernMount";
const ROOT_ID = "engram-root";

let mounted = false;

/**
 * 挂载 Engram 唯一的 React 根。
 *
 * 幂等：重复调用安全（已有则跳过）。挂载后 EngramRoot 自行根据 uiStore 决定渲染什么，
 * 调用方（bootstrap / ST 按钮处理器）只需要翻状态。
 */
export async function mountEngram(): Promise<void> {
    if (mounted) {
        return;
    }

    let root = document.getElementById(ROOT_ID);
    if (!root) {
        root = document.createElement("div");
        root.id = ROOT_ID;
        root.className = "engram-app-root";
        document.body.append(root);
    }

    const { EngramRoot } = await import("@/ui/root/EngramRoot.tsx");
    createRoot(root).render(<EngramRoot />);
    mounted = true;
    Logger.info(MODULE, "React 根已挂载 (#engram-root)");
}
