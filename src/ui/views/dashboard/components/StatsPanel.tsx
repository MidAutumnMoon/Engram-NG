import type { EngramSettings } from "@/config/settings";
import {
    BrainCircuit,
    Cpu,
    Fingerprint,
    LibraryBig,
    MessageSquareText,
} from "lucide-react";
import React from "react";

interface StatsPanelProps {
    stats: EngramSettings["statistics"];
}

export const StatsPanel: React.FC<StatsPanelProps> = ({ stats }) => {
    const formatNumber = (num: number) => {
        if (num >= 1_000_000) return (num / 1000000).toFixed(1) + "M";
        if (num >= 1000) return (num / 1000).toFixed(1) + "k";
        return num.toString();
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. 总 Token 消耗 (Resource) */}
                <div className="rounded-xl p-4 border border-border/50 bg-muted/20 flex flex-col gap-2 hover:border-primary/30 transition-colors">
                    <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-[10px] uppercase tracking-wider font-semibold">
                            Token 消耗总计
                        </span>
                        <Cpu size={14} className="text-primary/70" />
                    </div>
                    <div className="flex items-end gap-1.5">
                        <span className="text-2xl font-mono text-value font-medium tracking-tight">
                            {formatNumber(stats.totalTokens)}
                        </span>
                        <span className="text-[10px] text-muted-foreground mb-1 shadow-sm">
                            Tokens
                        </span>
                    </div>
                </div>

                {/* 2. LLM Invoke Count */}
                <div className="rounded-xl p-4 border border-border/50 bg-muted/20 flex flex-col gap-2 hover:border-primary/30 transition-colors">
                    <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-[10px] uppercase tracking-wider font-semibold">
                            LLM 引擎调用
                        </span>
                        <MessageSquareText
                            size={14}
                            className="text-indigo-400/70"
                        />
                    </div>
                    <div className="flex items-end gap-1.5">
                        <span className="text-2xl font-mono text-value font-medium tracking-tight">
                            {formatNumber(stats.totalLlmCalls)}
                        </span>
                        <span className="text-[10px] text-muted-foreground mb-1 shadow-sm">
                            Calls
                        </span>
                    </div>
                </div>

                {/* 3. Event & Entity Creation (Productivity) */}
                <div className="rounded-xl p-4 border border-border/50 bg-muted/20 flex flex-col gap-2 hover:border-primary/30 transition-colors">
                    <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-[10px] uppercase tracking-wider font-semibold">
                            系统记忆构建
                        </span>
                        <LibraryBig size={14} className="text-emerald-500/70" />
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-mono text-emerald-400 font-medium tracking-tight">
                            {formatNumber(stats.totalEvents)}
                        </span>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Fingerprint size={10} />
                            <span>{stats.totalEntities}</span>
                        </div>
                    </div>
                </div>

                {/* 4. RAG Injections & Retention */}
                <div className="rounded-xl p-4 border border-border/50 bg-muted/20 flex flex-col gap-2 hover:border-primary/30 transition-colors">
                    <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-[10px] uppercase tracking-wider font-semibold">
                            RAG 上下文召回
                        </span>
                        <BrainCircuit size={14} className="text-amber-500/70" />
                    </div>
                    <div className="flex items-end gap-1.5">
                        <span className="text-2xl font-mono text-amber-400 font-medium tracking-tight">
                            {formatNumber(stats.totalRagInjections)}
                        </span>
                        <span className="text-[10px] text-muted-foreground mb-1 shadow-sm">
                            Times
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};
