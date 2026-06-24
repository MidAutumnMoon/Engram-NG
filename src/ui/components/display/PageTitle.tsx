import React from "react";
import { ChevronRight } from "lucide-react";

interface PageTitleProps {
    title: string;
    subtitle?: string;
    /** Optional parent label, rendered as 'Parent > Title' */
    parent?: string;
}

export const PageTitle: React.FC<PageTitleProps> = ({
    title,
    subtitle,
    parent,
}) => (
    <div className="px-4 md:px-0">
        <h1 className="text-3xl font-light tracking-tight text-foreground flex items-center gap-2">
            {parent && (
                <>
                    <span className="text-muted-foreground/60 text-xl">
                        {parent}
                    </span>
                    <ChevronRight
                        size={20}
                        className="text-muted-foreground/30 px-0.5"
                    />
                </>
            )}
            <span className="drop-shadow-[0_0_15px_rgba(255,255,255,0.2)] text-foreground">
                {title}
            </span>
        </h1>
        {subtitle && (
            <p className="mt-2 text-muted-foreground text-xs font-light">
                {subtitle}
            </p>
        )}
    </div>
);
