/**
 * 编辑器内「行内开关」原语 — 标签 + 描述 + 自定义 peer toggle。
 *
 * 抽取自 EventEditor 中归档/锁定两处复制粘贴的 `<label><input peer/>...</label>` 块。
 * activeColor 区分两种状态强调色（锁定=emphasis，归档=primary）。
 */
import React from "react";

interface ToggleRowProps {
    label: string;
    hint: string;
    icon: React.ReactNode;
    checked: boolean;
    activeColor: "emphasis" | "primary";
    onChange: (next: boolean) => void;
}

export const ToggleRow: React.FC<ToggleRowProps> = ({
    label,
    hint,
    icon,
    checked,
    activeColor,
    onChange,
}) => (
    <div className="flex justify-between items-center py-2">
        <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
                <span className="text-xs text-meta">{label}</span>
                {icon}
            </div>
            <span className="text-[10px] text-meta/60">{hint}</span>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
            <input
                type="checkbox"
                className="sr-only peer"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
            />
            <div
                className={`w-9 h-5 bg-border rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-border after:border after:rounded-full after:h-4 after:w-4 ${
                    activeColor === "emphasis"
                        ? "peer-checked:bg-emphasis"
                        : "peer-checked:bg-primary"
                }`}
            />
        </label>
    </div>
);
