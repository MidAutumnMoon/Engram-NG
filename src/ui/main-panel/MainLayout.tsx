import Header from "./Header.tsx";
import { Sidebar } from "./Sidebar.tsx";
import React from "react";

interface MainLayoutProps {
    children: React.ReactNode;
    activeTab: string;
    setActiveTab: (tab: string) => void;
    onClose: () => void;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
    children,
    activeTab,
    setActiveTab,
    onClose,
}) => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

    return (
        <div
            className="engram-app-root flex absolute inset-0 w-full h-full bg-background/40 text-foreground overflow-hidden font-sans selection:bg-primary/30 selection:text-primary"
            id="engram-layout-root"
        >
            {/* PC 端侧边栏 */}
            <Sidebar
                activeTab={activeTab}
                onNavigate={setActiveTab}
                isMobile={false}
                onClosePanel={onClose}
            />

            {/* 移动端侧边栏（抽屉） */}
            <Sidebar
                activeTab={activeTab}
                onNavigate={setActiveTab}
                isMobile
                isOpen={isMobileMenuOpen}
                onClose={() => setIsMobileMenuOpen(false)}
            />

            {/* Right Content Area (Header + Main) */}
            <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex flex-col shrink-0 border-b border-border bg-sidebar/80 z-50 md:hidden">
                    <Header
                        onToggleSidebar={() =>
                            setIsMobileMenuOpen(!isMobileMenuOpen)}
                        onClose={onClose}
                    />
                </div>

                {/* Main Content Area */}
                <main className="flex-1 flex flex-col relative w-full overflow-hidden bg-background/80">
                    <div
                        key={activeTab}
                        className="flex-1 min-h-0 px-4 md:px-8 lg:px-12 pt-3 md:pt-4"
                    >
                        <div className="max-w-6xl mx-auto h-full">
                            {children}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
};
