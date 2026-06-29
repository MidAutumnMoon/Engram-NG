import React from "react";
import { ChevronRight } from "lucide-react";

interface PageTitleProps {
    title: string;
    subtitle?: string;
    /** Optional parent label, rendered as 'Parent > Title' */
    parent?: string;
    /** 右侧操作区（如保存按钮）。无 TabPills 的视图用它承载主操作。 */
    actions?: React.ReactNode;
}

export const PageTitle: React.FC<PageTitleProps> = ({
    title,
    subtitle,
    parent,
    actions,
}) => (
    <div className="px-4 md:px-0 flex items-center justify-between gap-2">
        <h1 className="text-3xl font-light tracking-tight text-foreground flex items-baseline gap-2 flex-wrap">
            {parent && (
                <>
                    <span className="text-muted-foreground/60 text-xl">
                        {parent}
                    </span>
                    <ChevronRight
                        size={20}
                        className="text-muted-foreground/30 px-0.5 self-center"
                    />
                </>
            )}
            <span className="drop-shadow-[0_0_15px_rgba(255,255,255,0.2)] text-foreground">
                {title}
            </span>
            {subtitle && (
                <span className="text-xs text-muted-foreground font-light ml-2">
                    {subtitle}
                </span>
            )}
        </h1>
        {actions && <div className="shrink-0">{actions}</div>}
    </div>
);
