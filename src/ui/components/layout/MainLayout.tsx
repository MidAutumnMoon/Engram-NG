import { UpdateService } from "@/core/updater/Updater";
import { UpdateNotice } from "@/ui/components/feedback/UpdateNotice";
import Header from "@/ui/components/layout/Header";
import { Sidebar } from "@/ui/components/layout/Sidebar";
import { GlobalStyles } from "@/ui/styles/GlobalStyles";
import React, { useEffect, useState } from "react";

interface MainLayoutProps {
    children: React.ReactNode;
    activeTab: string;
    setActiveTab: (tab: string) => void;
    onClose: () => void;
}

export const MainLayout: React.FC<MainLayoutProps> = (
    { children, activeTab, setActiveTab, onClose },
) => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [showUpdateNotice, setShowUpdateNotice] = useState(false);
    const [hasUnreadUpdate, setHasUnreadUpdate] = useState(false);

    // 检测是否有未读更新
    useEffect(() => {
        const checkUpdate = async () => {
            try {
                const unread = await UpdateService.hasUnreadUpdate();
                setHasUnreadUpdate(unread);
            } catch (error) {
                console.debug("[Engram] 检查更新失败", error);
            }
        };
        checkUpdate();
    }, []);

    const handleShowUpdateNotice = () => {
        setShowUpdateNotice(true);
    };

    const handleCloseUpdateNotice = () => {
        setShowUpdateNotice(false);
        setHasUnreadUpdate(false);
    };

    return (
        <div
            className="engram-app-root flex absolute inset-0 w-full h-full bg-background/40 backdrop-blur-md text-foreground overflow-hidden font-sans selection:bg-primary/30 selection:text-primary"
            id="engram-layout-root"
        >
            <GlobalStyles />

            {/* Update Notice Modal */}
            <UpdateNotice
                isOpen={showUpdateNotice}
                onClose={handleCloseUpdateNotice}
            />

            {/* PC 端侧边栏 */}
            <Sidebar
                activeTab={activeTab}
                onNavigate={setActiveTab}
                isMobile={false}
                onShowUpdateNotice={handleShowUpdateNotice}
                hasUnreadUpdate={hasUnreadUpdate}
            />

            {/* 移动端侧边栏（抽屉） */}
            <Sidebar
                activeTab={activeTab}
                onNavigate={setActiveTab}
                isMobile={true}
                isOpen={isMobileMenuOpen}
                onClose={() => setIsMobileMenuOpen(false)}
                onShowUpdateNotice={handleShowUpdateNotice}
                hasUnreadUpdate={hasUnreadUpdate}
            />

            {/* Right Content Area (Header + Main) */}
            <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex flex-col shrink-0 border-b border-border bg-sidebar/80 backdrop-blur-xl z-50 transition-all duration-300">
                    <Header
                        onToggleSidebar={() =>
                            setIsMobileMenuOpen(!isMobileMenuOpen)}
                        isMobile={false}
                        onClose={onClose}
                        onNavigate={(path) =>
                            setActiveTab(path.replace("/", ""))}
                    />

                    {/* Header Extension Slot (Portal Target) */}
                    <div
                        id="engram-header-extension"
                        className="z-40 shrink-0 bg-transparent transition-all empty:hidden"
                    />
                </div>

                {/* Main Content Area */}
                <main className="flex-1 flex flex-col relative w-full overflow-hidden bg-background/80 backdrop-blur-xl">
                    <div
                        key={activeTab}
                        className="flex-1 overflow-y-auto overflow-x-hidden pt-0 px-4 md:px-8 lg:px-12 scroll-smooth w-full h-full pb-8 md:pb-12 lg:pb-16"
                    >
                        <div className="max-w-6xl mx-auto min-h-full pb-20">
                            {children}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
};
