/**
 * WorldbookConfigForm 的内部子组件。
 *
 * 把原本 14 层缩进的条目渲染拆为：
 * - WorldbookHeader   世界书头部（展开箭头 + 名称 + 激活计数 + 总开关）
 * - WorldbookEntryRow 单条目（状态灯 + 名称 + 关键词徽章 + 预览 + 开关）
 */
import { SwitchField } from "@/ui/components/form/FormComponents.tsx";
import { Book, ChevronDown, ChevronRight } from "lucide-react";
import React from "react";

export interface WorldbookEntry {
    uid: number;
    name?: string;
    names?: string[];
    keys?: string[];
    comment?: string;
    content?: string;
    disabled?: boolean;
    constant?: boolean;
}

interface WorldbookHeaderProps {
    book: string;
    isExpanded: boolean;
    isDisabled: boolean;
    activeEntriesCount: number;
    totalEntries: number;
    onToggleExpand: () => void;
    onToggle: (disabled: boolean) => void;
}

export const WorldbookHeader: React.FC<WorldbookHeaderProps> = ({
    book,
    isExpanded,
    isDisabled,
    activeEntriesCount,
    totalEntries,
    onToggleExpand,
    onToggle,
}) => (
    <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3 flex-1 overflow-hidden">
            <button
                type="button"
                onClick={onToggleExpand}
                className="p-1 hover:bg-accent rounded-sm"
            >
                {isExpanded
                    ? <ChevronDown size={16} />
                    : <ChevronRight size={16} />}
            </button>
            <div className="flex items-center gap-2 min-w-0">
                <Book
                    size={16}
                    className={isDisabled
                        ? "text-muted-foreground"
                        : "text-primary"}
                />
                <span
                    className={`font-medium truncate ${
                        isDisabled && "text-muted-foreground line-through"
                    }`}
                >
                    {book}
                </span>
                <span className="text-xs text-muted-foreground px-2 py-0.5 bg-muted rounded-full whitespace-nowrap">
                    {activeEntriesCount} / {totalEntries} 激活
                </span>
            </div>
        </div>
        <div className="flex items-center gap-4">
            <SwitchField
                label=""
                checked={!isDisabled}
                onChange={(checked) => onToggle(!checked)}
                compact
            />
        </div>
    </div>
);

interface WorldbookEntryRowProps {
    entry: WorldbookEntry;
    isDisabled: boolean;
    onToggle: (disabled: boolean) => void;
}

export const WorldbookEntryRow: React.FC<WorldbookEntryRowProps> = ({
    entry,
    isDisabled,
    onToggle,
}) => {
    const statusDot = entry.disabled
        ? "bg-muted-foreground/50"
        : (entry.constant ? "bg-primary" : "bg-emerald-500");
    const statusTitle = entry.disabled
        ? "已禁用 (世界书原设定)"
        : (entry.constant ? "常驻 (Constant) 🔵" : "条件触发 (Selective) 🟢");

    const displayName = entry.name || `条目 #${entry.uid}`;
    const visibleKeys = (entry.keys ?? []).slice(0, 3);
    const extraKeys = (entry.keys?.length ?? 0) - visibleKeys.length;
    const preview = entry.comment || entry.content;

    return (
        <div
            className={`flex items-start justify-between py-2 -mx-2 px-2 rounded hover:bg-accent/40 group ${
                isDisabled && "opacity-40"
            }`}
        >
            <div className="flex flex-col gap-1 min-w-0 flex-1 pr-4">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                    {/* 状态指示灯 V1.2.9: 蓝=constant / 绿=selective / 灰=世界书原本禁用 */}
                    <div
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot}`}
                        title={statusTitle}
                    />

                    {/* 条目名称 */}
                    <span
                        className={`text-sm font-medium truncate max-w-full ${
                            isDisabled
                                ? "text-muted-foreground line-through"
                                : (entry.disabled
                                    ? "text-muted-foreground"
                                    : "text-foreground")
                        }`}
                    >
                        {displayName}
                    </span>

                    {/* 关键词 Badge */}
                    {(entry.keys?.length ?? 0) > 0 && (
                        <div className="flex items-center gap-1 ml-auto md:ml-2 overflow-hidden max-w-full">
                            {visibleKeys.map((key: string, i: number) => (
                                <span
                                    key={i}
                                    className="text-[10px] px-1 py-0.5 rounded border border-border bg-muted/20 text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis max-w-[80px]"
                                >
                                    {key}
                                </span>
                            ))}
                            {extraKeys > 0 && (
                                <span className="text-[10px] text-muted-foreground">
                                    +{extraKeys}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* 内容预览 */}
                {preview && (
                    <p className="text-xs text-muted-foreground/80 pl-3.5 break-words line-clamp-2">
                        {preview}
                    </p>
                )}
            </div>
            <div className="flex-shrink-0">
                <SwitchField
                    label=""
                    checked={!isDisabled}
                    onChange={(checked) => onToggle(!checked)}
                    compact
                />
            </div>
        </div>
    );
};
