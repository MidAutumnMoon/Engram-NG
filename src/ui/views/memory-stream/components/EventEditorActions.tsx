/**
 * 事件编辑器头部操作按钮组（归档 / 锁定 / 删除）。
 *
 * EventEditor 的全屏与侧边栏两套头部复制了同一组按钮；此处统一。
 * 调用方负责传入当前状态与切换回调（切换时需立即同步到父组件）。
 */
import { Archive, Lock, LockOpen, Trash2 } from "lucide-react";
import React from "react";

interface EventEditorActionsProps {
    isArchived: boolean;
    isLocked: boolean;
    onToggleArchive: (next: boolean) => void;
    onToggleLock: (next: boolean) => void;
    onDelete: () => void;
}

export const EventEditorActions: React.FC<EventEditorActionsProps> = ({
    isArchived,
    isLocked,
    onToggleArchive,
    onToggleLock,
    onDelete,
}) => (
    <>
        <button
            type="button"
            onClick={() => onToggleArchive(!isArchived)}
            className={`p-1.5 rounded ${
                isArchived
                    ? "text-primary bg-primary/10"
                    : "text-meta hover:bg-muted/50"
            }`}
            title={isArchived ? "取消归档" : "归档"}
        >
            <Archive
                size={16}
                className={isArchived ? "fill-current" : ""}
            />
        </button>
        <button
            type="button"
            onClick={() => onToggleLock(!isLocked)}
            className={`p-1.5 rounded ${
                isLocked
                    ? "text-emphasis bg-emphasis/10"
                    : "text-meta hover:bg-muted/50"
            }`}
            title={isLocked ? "解锁" : "锁定"}
        >
            {isLocked ? <Lock size={16} /> : <LockOpen size={16} />}
        </button>
        <button
            type="button"
            onClick={onDelete}
            className="p-1.5 text-destructive hover:bg-destructive/10 rounded ml-1"
            title="删除"
        >
            <Trash2 size={16} />
        </button>
    </>
);
