/**
 * LogEntryItem - 单条日志渲染组件
 */

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { LogEntry } from "@/logger/Logger.ts";
import { LogLevel, LogLevelConfig } from "@/logger/Logger.ts";
import { getModuleMeta } from "./moduleMeta.ts";
import { safeStringify } from "@/utils/safeStringify.ts";

/**
 * 格式化时间为 HH:MM:SS
 */
function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toTimeString().slice(0, 8);
}

// 级别样式映射 - 简洁配色（加深 DEBUG 颜色）
// rowBg 仅对 WARN/ERROR 生效，为整行提供醒目背景；其他级别透明。
const LEVEL_STYLES: Record<
    LogLevel,
    { text: string; bg: string; rowBg?: string }
> = {
    [LogLevel.DEBUG]: { bg: "bg-zinc-500/15", text: "text-zinc-400" },
    [LogLevel.INFO]: { bg: "bg-blue-500/10", text: "text-blue-400" },
    [LogLevel.SUCCESS]: {
        bg: "bg-emerald-500/10",
        text: "text-emerald-400",
    },
    [LogLevel.WARN]: {
        bg: "bg-amber-500/10",
        rowBg: "bg-amber-500/[0.06]",
        text: "text-amber-400",
    },
    [LogLevel.ERROR]: {
        bg: "bg-red-500/10",
        rowBg: "bg-red-500/[0.08]",
        text: "text-red-400",
    },
};

/**
 * 单条日志项
 */
export const LogEntryItem: React.FC<{ entry: LogEntry }> = ({ entry }) => {
    // 自动展开错误和警告
    const autoExpand = entry.level === LogLevel.WARN ||
        entry.level === LogLevel.ERROR;
    const [expanded, setExpanded] = useState(autoExpand);
    const hasData = entry.data != null;
    const levelConfig = LogLevelConfig[entry.level];
    const levelStyle = LEVEL_STYLES[entry.level];

    return (
        <div className="group">
            <div
                className={`
                    flex items-start gap-3 px-2 py-1 rounded-sm
                    ${levelStyle.rowBg ?? "hover:bg-white/[0.02]"}
                    ${hasData ? "cursor-pointer" : ""}
                `}
                onClick={() => hasData && setExpanded(!expanded)}
                onKeyDown={hasData
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setExpanded(!expanded);
                        }
                    }
                    : undefined}
                role={hasData ? "button" : undefined}
                tabIndex={hasData ? 0 : undefined}
                aria-expanded={hasData ? expanded : undefined}
            >
                {/* 展开箭头 */}
                <span className="flex items-center text-zinc-600 shrink-0 mt-0.5 w-3">
                    {hasData
                        ? (
                            expanded
                                ? (
                                    <ChevronDown size={12} />
                                )
                                : (
                                    <ChevronRight size={12} />
                                )
                        )
                        : null}
                </span>

                {/* 时间戳 - 加深颜色 */}
                <span className="text-zinc-500 shrink-0 tabular-nums text-[11px]">
                    {formatTime(entry.timestamp)}
                </span>

                {/* 级别标签 - 紧凑样式，固定最小宽度保证对齐 */}
                <span
                    className={`
                    shrink-0 min-w-[3rem] inline-flex justify-center items-center
                    text-[10px] font-medium px-1.5 py-0.5 rounded
                    ${levelStyle.text} ${levelStyle.bg}
                `}
                >
                    {levelConfig.label}
                </span>

                {/* 模块图标 — 单色弱化，不参与层级强调（颜色留给级别 badge） */}
                {React.createElement(getModuleMeta(entry.module).icon, {
                    className: "shrink-0 text-zinc-500",
                    size: 11,
                })}

                {/* 模块标签 - 加深颜色 */}
                <span className="text-zinc-400 shrink-0 text-[11px]">
                    {entry.module}
                </span>

                {/* 消息内容 */}
                <span className="text-zinc-300 text-[11px] break-words flex-1 leading-relaxed">
                    {entry.message}
                </span>
            </div>

            {/* 展开的数据详情 — WARN/ERROR 延续行背景，其他级别用默认暗色块 */}
            {expanded && hasData && (
                <div
                    className={`ml-10 mr-2 mb-1 px-3 py-2 border-l-2 border-zinc-700 rounded-r text-[10px] ${
                        levelStyle.rowBg ?? "bg-zinc-900/50"
                    }`}
                >
                    <pre className="m-0 text-zinc-400 whitespace-pre-wrap break-words font-mono">
                        {safeStringify(entry.data)}
                    </pre>
                </div>
            )}
        </div>
    );
};
