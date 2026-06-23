/**
 * 单一 React 根挂载
 *
 * bootstrap 调一次 mountEngram()：确保 `#engram-root` 存在，createRoot 后渲染
 * EngramRoot。可见性、页面切换全部由 uiStore 驱动——这里只负责把 React 挂上去。
 *
 * 生命周期是有意的一次性：createRoot 的返回值被丢弃，没有 unmount/re-render 入口。
 * 如果未来需要热重载或拆卸，需要重新设计这个模块。
 */
import { Logger } from "@/logger/Logger.ts";
import { createRoot } from "react-dom/client";

const MODULE = "TavernMount";
const ROOT_ID = "engram-root";

let mounted = false;

/**
 * 挂载 Engram 唯一的 React 根。幂等：重复调用安全。
 *
 * 复用已存在的 `#engram-root`（如 HMR 或重试场景下）；否则新建并 append 到 body。
 * 挂载后由 EngramRoot 根据 uiStore 决定渲染什么，调用方只需要翻状态。
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
