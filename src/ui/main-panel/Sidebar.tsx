/**
 * Sidebar - 统一侧边栏组件
 *
 * 支持 PC 端和移动端两种模式。导航项按 NAV_SECTIONS 分组，每组带小号大写标题。
 * PC / 移动端共用 NavItemButton，仅 variant 不同；尺寸/状态类预计算，避免嵌套三元。
 */
import {
    NAV_ITEMS,
    NAV_SECTIONS,
    type NavItem,
} from "@/ui/navigation.ts";
import { EngramTextLogo } from "@/ui/assets/icons/EngramTextLogo.tsx";
import { X } from "lucide-react";
import React from "react";
import manifest from "../../../manifest.json" with { type: "json" };

interface SidebarProps {
    /** 当前激活的标签 ID */
    activeTab: string;
    /** 导航回调 */
    onNavigate: (tabId: string) => void;
    /** 是否为移动端模式 */
    isMobile: boolean;
    /** 移动端：是否打开 */
    isOpen?: boolean;
    /** 移动端：关闭抽屉 */
    onClose?: () => void;
    /** PC 端：关闭整个扩展面板 */
    onClosePanel?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
    activeTab,
    onNavigate,
    isMobile,
    isOpen = false,
    onClose,
    onClosePanel,
}) => {
    const handleNavClick = (tabId: string) => {
        onNavigate(tabId);
        if (isMobile && onClose) onClose();
    };

    // 移动端未打开时不渲染
    if (isMobile && !isOpen) return null;

    // PC 端侧边栏
    if (!isMobile) {
        return (
            <aside className="flex w-44 shrink-0 bg-sidebar/80 flex-col z-40 pt-4 px-3 border-r border-border/50 max-md:hidden">
                <NavList
                    variant="desktop"
                    activeTab={activeTab}
                    onSelect={handleNavClick}
                />
                <div className="pb-3">
                    <SidebarFooter onClosePanel={onClosePanel} />
                </div>
            </aside>
        );
    }

    // 移动端抽屉
    return (
        <div
            className="fixed inset-0 z-60 flex justify-start"
            style={{ height: "100dvh", width: "100vw" }}
        >
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60"
                onClick={onClose}
            />

            {/* Drawer Content */}
            <div
                id="mobile-menu-drawer"
                className="relative w-64 max-w-[80vw] h-full bg-sidebar border-r border-border shadow-2xl flex flex-col p-6"
                style={{ height: "100dvh" }}
            >
                <div className="flex justify-between items-center mb-8">
                    <span className="text-lg font-semibold text-sidebar-foreground/80">
                        导航
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 -mr-2 rounded-md hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-accent-foreground"
                    >
                        <X size={20} />
                    </button>
                </div>

                <NavList
                    variant="mobile"
                    activeTab={activeTab}
                    onSelect={handleNavClick}
                />

                <div className="mt-auto">
                    <SidebarFooter onClosePanel={onClosePanel} />
                </div>
            </div>
        </div>
    );
};

/** 分组导航列表。PC / 移动端共用，variant 决定尺寸。 */
const NavList: React.FC<{
    variant: "desktop" | "mobile";
    activeTab: string;
    onSelect: (id: string) => void;
}> = ({ variant, activeTab, onSelect }) => {
    const mobile = variant === "mobile";
    return (
        <nav
            className={`flex-1 w-full flex flex-col ${
                mobile ? "gap-1.5" : "gap-0.5"
            } overflow-y-auto no-scrollbar`}
        >
            {NAV_SECTIONS.map((section, i) => (
                <div
                    key={section.id}
                    className={i > 0 ? "mt-3" : ""}
                >
                    <SectionLabel variant={variant}>
                        {section.label}
                    </SectionLabel>
                    <div className="flex flex-col gap-0.5">
                        {NAV_ITEMS
                            .filter((it) => it.section === section.id)
                            .map((item) => (
                                <NavItemButton
                                    key={item.id}
                                    item={item}
                                    variant={variant}
                                    isActive={activeTab.split(":")[0] ===
                                        item.id}
                                    onSelect={onSelect}
                                />
                            ))}
                    </div>
                </div>
            ))}
        </nav>
    );
};

/** 分组标题。 */
const SectionLabel: React.FC<{
    variant: "desktop" | "mobile";
    children: React.ReactNode;
}> = ({ variant, children }) => (
    <div
        className={`px-3 ${
            variant === "desktop" ? "pt-1 pb-1" : "pt-2 pb-1"
        } text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 select-none`}
    >
        {children}
    </div>
);

/** 单个导航按钮。尺寸/状态类在顶部一次算清，避免嵌套三元。 */
const NavItemButton: React.FC<{
    item: NavItem;
    variant: "desktop" | "mobile";
    isActive: boolean;
    onSelect: (id: string) => void;
}> = ({ item, variant, isActive, onSelect }) => {
    const Icon = item.icon;
    const mobile = variant === "mobile";

    const sizing = mobile
        ? "px-4 py-3 rounded-xl active:scale-[0.98]"
        : "px-3 py-2 rounded-lg";
    const state = isActive
        ? "bg-primary/10 text-primary font-medium"
        : mobile
            ? "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/10";
    const iconExtra = mobile
        ? isActive
            ? "text-primary"
            : "text-muted-foreground/70"
        : "";

    return (
        <button
            type="button"
            onClick={() => onSelect(item.id)}
            className={`group w-full flex items-center gap-2 text-left ${sizing} ${state}`}
        >
            <Icon
                size={mobile ? 22 : 18}
                strokeWidth={isActive ? 2 : 1.5}
                className={`shrink-0 group-hover:scale-110 ${iconExtra}`}
            />
            <span className={mobile ? "" : "text-sm"}>{item.label}</span>
        </button>
    );
};

/** 底部区域：关闭按钮 + Logo/版本。 */
const SidebarFooter: React.FC<{ onClosePanel?: () => void }> = (
    { onClosePanel },
) => (
    <div className="pt-4 border-t border-border/30 mt-2 space-y-2">
        {onClosePanel && (
            <button
                type="button"
                onClick={onClosePanel}
                className="group w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="关闭扩展"
            >
                <X
                    size={16}
                    strokeWidth={1.5}
                />
                <span className="text-xs">关闭</span>
                <kbd className="ml-auto px-0 py-0 bg-transparent text-[10px] font-mono text-muted-foreground/60 group-hover:text-destructive/70">
                    ESC
                </kbd>
            </button>
        )}

        <div className="flex items-center gap-2 px-2 py-1 opacity-50">
            <EngramTextLogo height={12} />
            <span className="text-[10px] text-muted-foreground font-mono">
                v{manifest.version}
            </span>
        </div>
    </div>
);
