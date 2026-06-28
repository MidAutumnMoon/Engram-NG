/**
 * RecallConfigForm 的内部子组件。
 *
 * 把原本三张复制粘贴的策略卡（Keyword / Embedding / Rerank）合并为
 * 一个数据驱动的 StrategyCard。
 */
import { Switch } from "@/ui/components/form/Switch.tsx";
import type { LucideIcon } from "lucide-react";
import React, { type ReactNode } from "react";

interface StrategyCardProps {
    icon: LucideIcon;
    title: string;
    description: ReactNode;
    enabled: boolean;
    onToggle: (enabled: boolean) => void;
    /** 开关禁用态（例如 Rerank 依赖 Embedding） */
    disabled?: boolean;
    /** 卡片展开时显示的额外内容（如 Keyword 的子选项） */
    children?: ReactNode;
}

export const StrategyCard: React.FC<StrategyCardProps> = ({
    icon: Icon,
    title,
    description,
    enabled,
    onToggle,
    disabled = false,
    children,
}) => (
    <div
        className={`p-4 rounded-lg border ${
            enabled
                ? "bg-primary/5 border-primary/30"
                : "bg-card border-border/50 hover:border-border"
        }`}
    >
        <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-medium">
                <Icon
                    size={16}
                    className={enabled
                        ? "text-primary"
                        : "text-muted-foreground"}
                />
                {title}
            </div>
            <Switch
                checked={enabled}
                disabled={disabled}
                onChange={onToggle}
            />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed italic">
            {description}
        </p>
        {children}
    </div>
);
