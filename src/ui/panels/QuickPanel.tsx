/**
 * QuickPanel - V0.8 快捷面板组件
 *
 * 独立于主面板的可拖拽悬浮面板
 * 用于快捷导航到各功能页面
 */

import { NAV_ITEMS } from "@/ui/navigation.ts";
import { FloatingPanel } from "@/ui/components/overlay/FloatingPanel.tsx";
import {
    BrainCircuit,
    Clapperboard,
    FileCog,
    FolderOpen,
    Search,
    Settings2,
    Wand2,
} from "lucide-react";
import { useCallback, useMemo } from "react";

interface QuickPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

const NAV_QUICK_LINKS = [
    {
        description: "事件流与编辑",
        icon: FolderOpen,
        id: "memory-list",
        label: "记忆列表",
        path: "memory:list",
    },
    {
        description: "实体管理视图",
        icon: BrainCircuit,
        id: "memory-entities",
        label: "实体列表",
        path: "memory:entities",
    },
    {
        description: "总结与精简参数",
        icon: FileCog,
        id: "processing-summary",
        label: "摘要配置",
        path: "processing:summary",
    },
    {
        description: "RAG 检索参数",
        icon: Search,
        id: "processing-recall",
        label: "召回配置",
        path: "processing:recall",
    },
    {
        description: "LLM / 向量 / Rerank",
        icon: FileCog,
        id: "presets-model",
        label: "模型配置",
        path: "presets:model:llm",
    },
    {
        description: "模板与自定义宏",
        icon: Wand2,
        id: "presets-prompt",
        label: "提示词模板",
        path: "presets:prompt:templates",
    },
    {
        description: "查看 LLM 通信记录",
        icon: Clapperboard,
        id: "devlog-model",
        label: "模型日志",
        path: "devlog:model",
    },
    {
        description: "外观与全局选项",
        icon: Settings2,
        id: "settings",
        label: "全局设置",
        path: "settings",
    },
] as const;

export function QuickPanel({ isOpen, onClose }: QuickPanelProps) {
    const handleNavigate = useCallback((path: string) => {
        import("@/sillytavern").then(({ openMainPanel }) => {
            openMainPanel();
        }).finally(() => {
            globalThis.setTimeout(() => {
                globalThis.dispatchEvent(
                    new CustomEvent("engram:navigate", { detail: path }),
                );
            }, 0);
            onClose();
        });
    }, [onClose]);

    const quickNavItems = useMemo(() => {
        const primaryItems = NAV_ITEMS.filter((item) => item.id !== "dashboard")
            .map((item) => ({
                description: "打开对应主页面",
                icon: item.icon,
                id: item.id,
                label: item.label,
                path: item.path.replace(/^\//, ""),
            }));

        return [
            ...NAV_QUICK_LINKS,
            ...primaryItems.filter((item) =>
                !NAV_QUICK_LINKS.some((link) => link.path === item.path)
            ),
        ];
    }, []);

    return (
        <FloatingPanel
            isOpen={isOpen}
            onClose={onClose}
            title="Engram 快捷面板"
            width={300}
            resizable={false}
        >
            <div className="space-y-2">
                <div className="text-xs px-1 text-muted-foreground">
                    快捷跳转
                </div>
                <div className="space-y-1 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                    {quickNavItems.map((item) => {
                        const Icon = item.icon;
                        return (
                            <button
                                key={item.id}
                                onClick={() => handleNavigate(item.path)}
                                className="w-full flex items-center gap-3 p-2 rounded-md transition-all text-left bg-muted/30 border border-border hover:border-primary/40 hover:bg-primary/5"
                            >
                                <Icon
                                    size={16}
                                    className="text-primary shrink-0"
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">
                                        {item.label}
                                    </div>
                                    <div className="text-xs text-muted-foreground truncate">
                                        {item.description}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
                <div
                    className="text-xs text-center pt-2"
                    style={{
                        borderTop:
                            "1px solid var(--border, rgba(255,255,255,0.1))",
                        color: "var(--muted-foreground, #888)",
                    }}
                >
                    支持记住主页面与部分子标签路径
                </div>
            </div>
        </FloatingPanel>
    );
}
