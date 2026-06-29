import { isDefaultRule, type RegexRule } from "@/domain/regex/RegexProcessor.ts";
import { GripVertical, Plus, Power, Trash2 } from "lucide-react";
import React, { useState } from "react";

interface RegexRuleListProps {
    rules: RegexRule[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
    onAdd: () => void;
    onReorder: (rules: RegexRule[]) => void;
}

export const RegexRuleList: React.FC<RegexRuleListProps> = ({
    rules,
    selectedId,
    onSelect,
    onToggle,
    onDelete,
    onAdd,
    onReorder,
}) => {
    const builtinRules = rules.filter((r) => isDefaultRule(r));
    const userRules = rules.filter((r) => !isDefaultRule(r));

    // 拖拽仅在「自定义规则」段内生效；索引是 userRules 内部的下标。
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    const handleDragStart = (index: number) => () => setDraggedIndex(index);

    const handleDragOver = (index: number) => (e: React.DragEvent) => {
        e.preventDefault(); // 允许 drop
        if (draggedIndex === null || draggedIndex === index) return;
        setDragOverIndex(index);
    };

    const handleDrop = (index: number) => (e: React.DragEvent) => {
        e.preventDefault();
        if (draggedIndex === null || draggedIndex === index) {
            setDraggedIndex(null);
            setDragOverIndex(null);
            return;
        }
        const nextUser = [...userRules];
        const [moved] = nextUser.splice(draggedIndex, 1);
        nextUser.splice(index, 0, moved);
        onReorder([...builtinRules, ...nextUser]);
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    const handleDragEnd = () => {
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    return (
        <div className="flex flex-col gap-4">
            {/* 内置规则（只读，仅可开关/选择） */}
            <RuleSection title="内置规则">
                <ul className="flex flex-col gap-1 list-none p-0 m-0">
                    {builtinRules.map((rule) => (
                        <RegexRuleRow
                            key={rule.id}
                            rule={rule}
                            selectedId={selectedId}
                            onSelect={onSelect}
                            onToggle={onToggle}
                        />
                    ))}
                </ul>
            </RuleSection>

            {/* 自定义规则（可编辑/拖拽/删除） */}
            <RuleSection
                title="自定义规则"
                action={
                    <button
                        type="button"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md shadow-sm active:scale-95"
                        onClick={onAdd}
                    >
                        <Plus size={14} strokeWidth={2.5} />
                        新增规则
                    </button>
                }
            >
                <ul className="flex flex-col gap-1 list-none p-0 m-0">
                    {userRules.map((rule, index) => (
                        <RegexRuleRow
                            key={rule.id}
                            rule={rule}
                            selectedId={selectedId}
                            onSelect={onSelect}
                            onToggle={onToggle}
                            onDelete={onDelete}
                            draggable
                            isDragged={draggedIndex === index}
                            isDragOver={
                                dragOverIndex === index &&
                                draggedIndex !== null &&
                                draggedIndex !== index
                            }
                            onDragStart={handleDragStart(index)}
                            onDragOver={handleDragOver(index)}
                            onDrop={handleDrop(index)}
                            onDragEnd={handleDragEnd}
                        />
                    ))}
                </ul>

                {userRules.length === 0 && (
                    <div className="text-center p-8 border border-dashed border-border rounded-lg">
                        <p className="text-xs text-muted-foreground">
                            暂无自定义规则
                        </p>
                    </div>
                )}
            </RuleSection>
        </div>
    );
};

/** 段落标题 + 右侧操作。 */
const RuleSection: React.FC<{
    title: string;
    action?: React.ReactNode;
    children: React.ReactNode;
}> = ({ title, action, children }) => (
    <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                {title}
            </h3>
            {action}
        </div>
        {children}
    </div>
);

/** 单条规则行。内置规则不传 onDelete/drag 相关 props（仅开关 + 选择）。 */
const RegexRuleRow: React.FC<{
    rule: RegexRule;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onToggle: (id: string) => void;
    onDelete?: (id: string) => void;
    draggable?: boolean;
    isDragged?: boolean;
    isDragOver?: boolean;
    onDragStart?: () => void;
    onDragOver?: (e: React.DragEvent) => void;
    onDrop?: (e: React.DragEvent) => void;
    onDragEnd?: () => void;
}> = ({
    rule,
    selectedId,
    onSelect,
    onToggle,
    onDelete,
    draggable = false,
    isDragged = false,
    isDragOver = false,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
}) => {
    const isSelected = selectedId === rule.id;
    return (
        <li
            draggable={draggable}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
            className={`
                group p-3 rounded-lg cursor-pointer border flex items-center gap-3
                ${isSelected
                    ? "bg-accent/50 border-input"
                    : "bg-transparent border-transparent hover:bg-muted/50 hover:border-border"}
                ${!rule.enabled && "opacity-50"}
                ${isDragged ? "opacity-40" : ""}
                ${isDragOver ? "border-t-2 border-t-primary" : ""}
            `}
            onClick={() => onSelect(rule.id)}
        >
            {/* Drag Handle（仅自定义规则） */}
            {draggable && (
                <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                    <GripVertical size={14} />
                </div>
            )}

            {/* Status/Toggle Icon */}
            <button
                type="button"
                className={`
                    w-8 h-8 flex items-center justify-center rounded-lg
                    ${rule.enabled
                        ? isSelected
                            ? "bg-primary/20 text-primary"
                            : "bg-muted text-primary"
                        : "bg-muted text-muted-foreground"}
                `}
                onClick={(e) => {
                    e.stopPropagation();
                    onToggle(rule.id);
                }}
                title={rule.enabled ? "点击禁用" : "点击启用"}
            >
                <Power size={14} />
            </button>

            <div className="flex-1 min-w-0">
                <h4
                    className={`text-sm font-medium truncate ${
                        isSelected
                            ? "text-foreground"
                            : "text-muted-foreground group-hover:text-foreground"
                    } ${!rule.enabled && "opacity-50 line-through"}`}
                >
                    {rule.name}
                </h4>
                <div className="mt-0.5 flex items-center gap-2">
                    <code className="text-[10px] bg-muted px-1 rounded text-muted-foreground font-mono truncate max-w-[120px]">
                        /{rule.pattern}/{rule.flags}
                    </code>
                </div>
            </div>

            {/* Delete Action（仅自定义规则） */}
            {onDelete && (
                <div
                    className={`flex items-center ${
                        isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                >
                    <button
                        type="button"
                        className="p-1.5 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(rule.id);
                        }}
                    >
                        <Trash2 size={12} />
                    </button>
                </div>
            )}
        </li>
    );
};
