import Header from "@/ui/shell/Header.tsx";
import { Sidebar } from "@/ui/shell/Sidebar.tsx";
import { GlobalStyles } from "@/ui/styles/GlobalStyles.tsx";
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
            className="engram-app-root flex absolute inset-0 w-full h-full bg-background/40 backdrop-blur-md text-foreground overflow-hidden font-sans selection:bg-primary/30 selection:text-primary"
            id="engram-layout-root"
        >
            <GlobalStyles />

            {/* PC 端侧边栏 */}
            <Sidebar
                activeTab={activeTab}
                onNavigate={setActiveTab}
                isMobile={false}
            />

            {/* 移动端侧边栏（抽屉） */}
            <Sidebar
                activeTab={activeTab}
                onNavigate={setActiveTab}
                isMobile={true}
                isOpen={isMobileMenuOpen}
                onClose={() => setIsMobileMenuOpen(false)}
            />

            {/* Right Content Area (Header + Main) */}
            <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex flex-col shrink-0 border-b border-border bg-sidebar/80 backdrop-blur-xl z-50">
                    <Header
                        onToggleSidebar={() =>
                            setIsMobileMenuOpen(!isMobileMenuOpen)}
                        isMobile={false}
                        onClose={onClose}
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
