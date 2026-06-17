/**
 * Engram - Graph RAG 记忆操作系统
 * 入口文件
 *
 * 只负责加载全局样式并启动 initializeEngram。
 * UI 状态由 uiStore 统一管理，React 挂载由 integrations/tavern/ui 通过动态 import 完成。
 */

import "@/ui/styles/main.css";
import { initializeEngram } from "@/integrations/tavern";

initializeEngram().catch((err) => {
    console.error("[Engram] 初始化失败", err);
});
