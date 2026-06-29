/**
 * Divider - 水平分割线
 *
 * 只是一根带上下间距的细线。其他布局需求（竖线、固定长度）直接用 Tailwind 即可。
 */
import React from "react";

interface DividerProps {
    /** 上下间距，默认 none */
    spacing?: "none" | "sm" | "md" | "lg";
    className?: string;
}

const spacingClasses = {
    lg: "my-6",
    md: "my-4",
    none: "",
    sm: "my-2",
};

export const Divider: React.FC<DividerProps> = ({
    spacing = "none",
    className = "",
}) => (
    <div
        className={`border-t border-border/30 ${
            spacingClasses[spacing]
        } ${className}`}
    />
);
