// 导航配置
import {
    BookText,
    Database,
    FileText,
    LayoutDashboard,
    ListTree,
    type LucideIcon,
    Regex,
    Server,
    Cpu,
    Settings,
    Terminal,
} from "lucide-react";

/**
 * Nav sections — 三段式分组。
 *
 * workspace: 高频读写区
 * config:    配置区（连接 + 行为）
 * system:    维护与全局开关
 */
export type NavSectionId = "workspace" | "config" | "system";

export interface NavItem {
    id: string;
    icon: LucideIcon;
    label: string;
    path: string;
    section: NavSectionId;
}

export interface NavSection {
    id: NavSectionId;
    label: string;
}

export const NAV_SECTIONS: NavSection[] = [
    { id: "workspace", label: "工作区" },
    { id: "config", label: "配置" },
    { id: "system", label: "系统" },
];

export const NAV_ITEMS: NavItem[] = [
    // ── 工作区 ──
    {
        icon: LayoutDashboard,
        id: "dashboard",
        label: "概览",
        path: "/dashboard",
        section: "workspace",
    },
    {
        icon: ListTree,
        id: "memory",
        label: "记忆",
        path: "/memory",
        section: "workspace",
    },
    {
        icon: Terminal,
        id: "devlog",
        label: "日志",
        path: "/devlog",
        section: "workspace",
    },
    // ── 配置 ──
    {
        icon: Server,
        id: "presets",
        label: "模型与服务",
        path: "/presets",
        section: "config",
    },
    {
        icon: Cpu,
        id: "processing",
        label: "处理流程",
        path: "/processing",
        section: "config",
    },
    {
        icon: FileText,
        id: "prompts",
        label: "提示词模板",
        path: "/prompts",
        section: "config",
    },
    {
        icon: Regex,
        id: "regex",
        label: "正则规则",
        path: "/regex",
        section: "config",
    },
    {
        icon: BookText,
        id: "worldbook",
        label: "世界书",
        path: "/worldbook",
        section: "config",
    },
    // ── 系统 ──
    {
        icon: Database,
        id: "data",
        label: "数据维护",
        path: "/data",
        section: "system",
    },
    {
        icon: Settings,
        id: "settings",
        label: "设置",
        path: "/settings",
        section: "system",
    },
];
