/**
 * Dropdown - 轻量内联下拉菜单
 *
 * 用于工具栏筛选等场景：触发按钮 + 绝对定位的选项面板。
 * 点击选项或外部自动关闭。
 */
import { ChevronDown } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

export interface DropdownOption<T> {
    value: T;
    label: string;
}

interface DropdownProps<T> {
    options: DropdownOption<T>[];
    value: T;
    onChange: (value: T) => void;
    /** 选项面板最小宽度（px） */
    minWidth?: number;
    /** 选项面板最大高度（px），超出滚动 */
    maxHeight?: number;
    /** 面板对齐方式 */
    align?: "left" | "right";
}

export function Dropdown<T>({
    options,
    value,
    onChange,
    minWidth = 100,
    maxHeight,
    align = "left",
}: DropdownProps<T>) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // 点击外部关闭
    useEffect(() => {
        if (!open) return;
        const handleOutside = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handleOutside);
        return () => document.removeEventListener("mousedown", handleOutside);
    }, [open]);

    const selected = options.find((o) => o.value === value);

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(!open)}
            >
                {selected?.label}
                <ChevronDown size={12} />
            </button>
            {open && (
                <div
                    className={`absolute top-full ${
                        align === "right" ? "right-0" : "left-0"
                    } mt-1 bg-popover border border-border rounded-md shadow-lg z-20 py-1 flex flex-col overflow-y-auto`}
                    style={{
                        minWidth: `${minWidth}px`,
                        maxHeight: maxHeight ? `${maxHeight}px` : undefined,
                    }}
                >
                    {options.map((opt) => (
                        <button
                            type="button"
                            key={String(opt.value)}
                            className={`block w-full text-left px-3 py-1.5 text-xs ${
                                opt.value === value
                                    ? "text-primary"
                                    : "hover:bg-accent"
                            }`}
                            onClick={() => {
                                onChange(opt.value);
                                setOpen(false);
                            }}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
