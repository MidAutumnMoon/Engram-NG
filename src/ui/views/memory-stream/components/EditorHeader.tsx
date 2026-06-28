/**
 * 编辑器共享头部 — 事件/实体编辑器共用的「返回 + 标题 + 操作按钮」外壳。
 *
 * 抽取自 EventEditor / EntityEditor 各自复制两遍（全屏 + 侧边栏）的头部标记。
 * 只负责布局；操作按钮由调用方通过 actions 插槽传入。
 */
import { ArrowLeft } from "lucide-react";
import React from "react";

interface EditorHeaderProps {
    title: string;
    onClose: () => void;
    variant: "fullscreen" | "sidebar";
    titleClassName?: string;
    actions?: React.ReactNode;
}

export const EditorHeader: React.FC<EditorHeaderProps> = ({
    title,
    onClose,
    variant,
    titleClassName,
    actions,
}) => (
    <div
        className={`flex items-center shrink-0 ${
            variant === "fullscreen"
                ? "gap-3 px-4 py-3 border-b border-border/50"
                : "gap-2 pb-4 border-b border-border"
        }`}
    >
        <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-meta hover:text-foreground hover:bg-muted/50 rounded"
            title="返回"
        >
            <ArrowLeft size={18} />
        </button>
        <h3 className={`text-sm font-medium flex-1 ${titleClassName}`}>
            {title}
        </h3>
        {actions && (
            <div className="flex items-center gap-1">{actions}</div>
        )}
    </div>
);
