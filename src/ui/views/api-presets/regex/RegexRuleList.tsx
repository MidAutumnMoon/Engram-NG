import type { RegexRule } from "@/domain/regex/index.ts";
import { Switch } from "@/ui/components/form/Switch.tsx";
import { GripVertical, Plus, Power, Trash2 } from "lucide-react";
import React, { useState } from "react";

interface RegexRuleListProps {
    rules: RegexRule[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
    onAdd: () => void;
    onReset: () => void;
    onReorder: (rules: RegexRule[]) => void;
    enableNativeRegex?: boolean;
    onToggleNativeRegex?: (enabled: boolean) => void;
}

export const RegexRuleList: React.FC<RegexRuleListProps> = ({
    rules,
    selectedId,
    onSelect,
    onToggle,
    onDelete,
    onAdd,
    onReset,
    onReorder,
    enableNativeRegex,
    onToggleNativeRegex,
}) => {
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    const handleDragStart = (index: number) => () => {
        setDraggedIndex(index);
    };

    const handleDragOver = (index: number) => (e: React.DragEvent) => {
        // Required to allow drop
        e.preventDefault();
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
        const next = [...rules];
        const [moved] = next.splice(draggedIndex, 1);
        next.splice(index, 0, moved);
        onReorder(next);
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    const handleDragEnd = () => {
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    正则规则列表
                </h3>
                <div className="flex gap-2">
                    <button
                        type="button"
                        className="text-[10px] text-muted-foreground hover:text-destructive"
                        onClick={onReset}
                    >
                        重置默认
                    </button>
                    <button
                        type="button"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md shadow-sm active:scale-95"
                        onClick={onAdd}
                    >
                        <Plus size={14} strokeWidth={2.5} />
                        新增规则
                    </button>
                </div>
            </div>

            {/* Native Compatibility Toggle */}
            <div className="bg-muted/10 border border-border/50 rounded-lg p-3 mb-2">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium">
                            酒馆原生 Regex 兼容
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5 break-words">
                            启用后将应用 SillyTavern 的 Regex 脚本
                        </p>
                    </div>

                    <Switch
                        checked={enableNativeRegex ?? true}
                        onChange={(checked) => onToggleNativeRegex?.(checked)}
                    />
                </div>
            </div>

            <ul className="flex flex-col gap-1 list-none p-0 m-0">
                {rules.map((rule, index) => (
                    <li
                        key={rule.id}
                        draggable
                        onDragStart={handleDragStart(index)}
                        onDragOver={handleDragOver(index)}
                        onDrop={handleDrop(index)}
                        onDragEnd={handleDragEnd}
                        className={`
                            group p-3 rounded-lg cursor-pointer border flex items-center gap-3
                            ${
                            selectedId === rule.id
                                ? "bg-accent/50 border-input"
                                : "bg-transparent border-transparent hover:bg-muted/50 hover:border-border"
                        }
                            ${!rule.enabled && "opacity-50"}
                            ${draggedIndex === index ? "opacity-40" : ""}
                            ${
                            dragOverIndex === index && draggedIndex !== null &&
                                draggedIndex !== index
                                ? "border-t-2 border-t-primary"
                                : ""
                        }
                        `}
                        onClick={() => onSelect(rule.id)}
                    >
                        {/* Drag Handle */}
                        <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                            <GripVertical size={14} />
                        </div>

                        {/* Status/Toggle Icon */}
                        <button
                            type="button"
                            className={`
                                w-8 h-8 flex items-center justify-center rounded-lg
                                ${
                                rule.enabled
                                    ? selectedId === rule.id
                                        ? "bg-primary/20 text-primary"
                                        : "bg-muted text-primary"
                                    : "bg-muted text-muted-foreground"
                            }
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
                            <div className="flex items-center justify-between">
                                <h4
                                    className={`text-sm font-medium truncate ${
                                        selectedId === rule.id
                                            ? "text-foreground"
                                            : "text-muted-foreground group-hover:text-foreground"
                                    } ${
                                        !rule.enabled &&
                                        "opacity-50 line-through"
                                    }`}
                                >
                                    {rule.name}
                                </h4>
                            </div>
                            <div className="mt-0.5 flex items-center gap-2">
                                <code className="text-[10px] bg-muted px-1 rounded text-muted-foreground font-mono truncate max-w-[120px]">
                                    /{rule.pattern}/{rule.flags}
                                </code>
                            </div>
                        </div>

                        {/* Delete Action */}
                        <div
                            className={`flex items-center ${
                                selectedId === rule.id
                                    ? "opacity-100"
                                    : "opacity-0 group-hover:opacity-100"
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
                    </li>
                ))}
            </ul>

            {rules.length === 0 && (
                <div className="text-center p-8 border border-dashed border-border rounded-lg">
                    <p className="text-xs text-muted-foreground">无规则</p>
                </div>
            )}
        </div>
    );
};
