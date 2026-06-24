/**
 * RuntimeLogTab - 运行日志 Tab
 *
 * 从 DevLog 抽取：订阅 Logger、过滤/展示运行时日志。
 * 模型日志、召回日志各自有独立 store 与组件，本 Tab 只处理 runtime。
 *
 * 虚拟化：使用 react-virtuoso 渲染日志，DOM 节点数固定在可见窗口大小，
 * 不随 logCache 增长。followOutput 取代手动 auto-scroll——仅当用户停在
 * 底部时跟随新日志；用户上滑阅读时新日志不打扰。
 */
import React, { useEffect, useMemo, useState } from "react";
import { Search, Terminal, Trash2 } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import type { LogEntry, LogLevel } from "@/logger/Logger.ts";
import { Logger, LogLevelConfig } from "@/logger/Logger.ts";
import { ALL_MODULES } from "@/logger/LogModule.ts";
import { LogEntryItem } from "./LogEntryItem.tsx";
import { Dropdown } from "@/ui/components/form/Dropdown.tsx";
import type { DropdownOption } from "@/ui/components/form/Dropdown.tsx";
import { EmptyState } from "@/ui/components/display/EmptyState.tsx";

// V0.9.10: 模块列表自动生成（不再硬编码）
const MODULES = ["ALL", ...ALL_MODULES];

const MODULE_OPTIONS: DropdownOption<string>[] = MODULES.map((m) => ({
    label: m,
    value: m,
}));

// 级别选项：null 表示不筛选（取代旧的 -1 sentinel）
const LEVEL_OPTIONS: DropdownOption<LogLevel | null>[] = [
    { label: "全部级别", value: null },
    ...Object.entries(LogLevelConfig).map(([level, config]) => ({
        label: config.label,
        value: Number(level) as LogLevel,
    })),
];

// 工具栏竖向分隔线
const ToolbarDivider = () => <div className="w-px h-4 bg-border" />;

export const RuntimeLogTab: React.FC = () => {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [levelFilter, setLevelFilter] = useState<LogLevel | null>(null);
    const [moduleFilter, setModuleFilter] = useState("ALL");

    // 初始化和订阅日志
    useEffect(() => {
        setLogs(Logger.getLogs());
        const unsubscribe = Logger.subscribe((entry) => {
            setLogs((prev) => [...prev, entry]);
        });
        return () => unsubscribe();
    }, []);

    // 过滤日志（derived — 不用 state，避免多余的渲染周期）
    const filteredLogs = useMemo(() => {
        let result = logs;
        if (levelFilter !== null) {
            result = result.filter((log) => log.level === levelFilter);
        }
        if (moduleFilter !== "ALL") {
            result = result.filter((log) => log.module === moduleFilter);
        }
        const trimmed = searchQuery.trim();
        if (trimmed) {
            const query = trimmed.toLowerCase();
            result = result.filter(
                (log) =>
                    log.message.toLowerCase().includes(query) ||
                    log.module.toLowerCase().includes(query),
            );
        }
        return result;
    }, [logs, levelFilter, moduleFilter, searchQuery]);

    const handleClear = () => {
        Logger.clear();
        setLogs([]);
    };

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* 工具栏 */}
            <div className="py-3 -mx-4 px-4 md:-mx-8 md:px-8 lg:-mx-12 lg:px-12 border-b border-border">
                <div className="flex items-center gap-2 flex-wrap">
                    {/* 级别过滤 */}
                    <Dropdown
                        options={LEVEL_OPTIONS}
                        value={levelFilter}
                        onChange={setLevelFilter}
                        minWidth={100}
                    />

                    <ToolbarDivider />

                    {/* 模块过滤 */}
                    <Dropdown
                        options={MODULE_OPTIONS}
                        value={moduleFilter}
                        onChange={setModuleFilter}
                        minWidth={120}
                        maxHeight={192}
                    />

                    <ToolbarDivider />

                    {/* 搜索框 */}
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Search size={12} />
                        <input
                            type="text"
                            placeholder="搜索日志..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground w-24 md:w-40"
                        />
                    </div>

                    {/* 右侧操作 */}
                    <div className="flex items-center gap-1 ml-auto">
                        <button
                            type="button"
                            className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                            onClick={handleClear}
                            title="清空"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                </div>
            </div>

            {/* 日志内容区 — 虚拟化：DOM 节点数固定，不随 logCache 增长 */}
            {logs.length === 0
                ? (
                    <EmptyState
                        icon={Terminal}
                        title="暂无日志记录"
                        className="flex-1"
                    />
                )
                : filteredLogs.length === 0
                ? (
                    <EmptyState
                        icon={Search}
                        title="没有匹配的日志"
                        description="尝试调整筛选条件"
                        className="flex-1"
                    />
                )
                : (
                    <div className="flex-1 min-h-0">
                        <Virtuoso
                            style={{ height: "100%" }}
                            className="font-mono text-xs leading-relaxed py-2"
                            data={filteredLogs}
                            // 打开页面即定位到最新日志（日志查看器的标准行为）
                            initialTopMostItemIndex={Math.max(
                                0,
                                filteredLogs.length - 1,
                            )}
                            // 用户停在底部 → 新日志自动跟随；用户上滑阅读 → 不打扰
                            followOutput={(isAtBottom) =>
                                isAtBottom ? "auto" : false}
                            itemContent={(_index, log) => (
                                <LogEntryItem entry={log} />
                            )}
                        />
                    </div>
                )}

            {/* 状态栏 - 简化 */}
            <div className="text-[10px] text-muted-foreground py-2 border-t border-border">
                {logs.length} 条日志
                {filteredLogs.length !== logs.length &&
                    ` · ${filteredLogs.length} 条匹配`}
            </div>
        </div>
    );
};
