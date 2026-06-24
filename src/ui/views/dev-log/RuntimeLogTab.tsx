/**
 * RuntimeLogTab - 运行日志 Tab
 *
 * 从 DevLog 抽取：订阅 Logger、过滤/分组/展示运行时日志。
 * 模型日志、召回日志各自有独立 store 与组件，本 Tab 只处理 runtime。
 */
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    ArrowDownToLine,
    Maximize2,
    Minimize2,
    Search,
    Terminal,
    Trash2,
} from "lucide-react";
import type { LogEntry, LogLevel } from "@/logger/Logger.ts";
import { Logger, LogLevelConfig } from "@/logger/Logger.ts";
import { ALL_MODULES } from "@/logger/LogModule.ts";
import { groupLogsByModule, LogGroup } from "./LogEntryItem.tsx";
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
    const [autoScroll, setAutoScroll] = useState(true);
    // V0.9.12: 分组展开控制
    const [defaultGroupExpanded, setDefaultGroupExpanded] = useState(true);

    const bottomRef = useRef<HTMLDivElement>(null);

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
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            result = result.filter(
                (log) =>
                    log.message.toLowerCase().includes(query) ||
                    log.module.toLowerCase().includes(query),
            );
        }
        return result;
    }, [logs, levelFilter, moduleFilter, searchQuery]);

    // V0.9.12: 将日志按模块分组
    const logGroups = useMemo(() => groupLogsByModule(filteredLogs), [
        filteredLogs,
    ]);

    // 自动滚动 — 仅在新日志进入时触发，不因过滤改变而抽动
    useEffect(() => {
        if (autoScroll && bottomRef.current) {
            bottomRef.current.scrollIntoView({
                behavior: "auto",
                block: "nearest",
            });
        }
    }, [logs.length, autoScroll]);

    const handleClear = useCallback(() => {
        Logger.clear();
        setLogs([]);
    }, []);

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* 工具栏 - sticky */}
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-3 -mx-4 px-4 md:-mx-8 md:px-8 lg:-mx-12 lg:px-12 border-b border-border">
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
                        {/* V0.9.12: 分组展开控制 */}
                        <button
                            type="button"
                            className={`p-1.5 rounded ${
                                defaultGroupExpanded
                                    ? "text-primary"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                            onClick={() =>
                                setDefaultGroupExpanded(!defaultGroupExpanded)}
                            title={defaultGroupExpanded
                                ? "折叠所有分组"
                                : "展开所有分组"}
                        >
                            {defaultGroupExpanded
                                ? <Minimize2 size={14} />
                                : <Maximize2 size={14} />}
                        </button>
                        <button
                            type="button"
                            className={`p-1.5 rounded ${
                                autoScroll
                                    ? "text-primary"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                            onClick={() => setAutoScroll(!autoScroll)}
                            title="自动滚动"
                        >
                            <ArrowDownToLine size={14} />
                        </button>
                        <button
                            type="button"
                            className="p-1.5 rounded text-muted-foreground hover:text-foreground"
                            onClick={handleClear}
                            title="清空"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                </div>
            </div>

            {/* 日志内容区 - 无边框 */}
            <div className="flex-1 overflow-y-auto font-mono text-xs leading-relaxed py-2">
                {filteredLogs.length === 0
                    ? (
                        <EmptyState
                            icon={Terminal}
                            title="暂无日志记录"
                            className="h-full"
                        />
                    )
                    : (
                        <>
                            {logGroups.map((group) => (
                                <LogGroup
                                    key={`${group[0].id}-${
                                        group[group.length - 1].id
                                    }`}
                                    entries={group}
                                    defaultExpanded={defaultGroupExpanded}
                                />
                            ))}
                            <div ref={bottomRef} />
                        </>
                    )}
            </div>

            {/* 状态栏 - 简化 */}
            <div className="text-[10px] text-muted-foreground py-2 border-t border-border">
                {logs.length} 条日志
                {filteredLogs.length !== logs.length &&
                    ` · ${filteredLogs.length} 条匹配`}
            </div>
        </div>
    );
};
