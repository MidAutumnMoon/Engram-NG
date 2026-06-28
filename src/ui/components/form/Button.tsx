import React from "react";

interface ModernButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    icon?: React.ElementType;
    label: string;
    primary?: boolean;
}

export const ModernButton: React.FC<ModernButtonProps> = ({
    icon: Icon,
    label,
    primary = false,
    className = "",
    ...props
}) => (
    <button
        className={`
            flex items-center gap-2 rounded-full font-medium

            hover:scale-[1.02] active:scale-95
            px-5 py-2.5 text-sm
            ${
            primary
                ? "bg-primary text-primary-foreground hover:opacity-90 hover:shadow-[0_0_20px_var(--primary)] border border-transparent"
                : "bg-transparent text-muted-foreground hover:text-foreground border border-border hover:border-input hover:bg-accent/50"
        }
            ${className}
        `}
        {...props}
    >
        {Icon &&
            <Icon
                size={16}
                className="group-hover:scale-110"
            />}
        {label}
    </button>
);
