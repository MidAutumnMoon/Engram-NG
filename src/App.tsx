import React, { useEffect, useState } from "react";
import { MainLayout } from "@/ui/shell/MainLayout.tsx";
import { SettingsManager } from "@/config/settings.ts";
import { EventBus } from "@/events/index.ts";

import { Dashboard } from "@/ui/views/dashboard/index.tsx";
import { DevLog } from "@/ui/views/dev-log/index.tsx";
import { APIPresets } from "@/ui/views/api-presets/APIPresetsView.tsx";
import { Settings } from "@/ui/views/settings/index.tsx";
import { MemoryStream } from "@/ui/views/memory-stream/index.tsx";
import { ProcessingView } from "@/ui/views/processing/ProcessingView.tsx";

interface AppProps {
    onClose: () => void;
}

const App: React.FC<AppProps> = ({ onClose }) => {
    const [activeTab, setActiveTab] = useState(() =>
        SettingsManager.get("lastOpenedTab") || "dashboard"
    );

    // Deep Link Navigation Handler
    const handleNavigate = (path: string) => {
        const cleanPath = path.replace(/^\//, "") || "dashboard";
        console.debug("[Engram] Navigating to:", cleanPath);
        setActiveTab(cleanPath);
        SettingsManager.set("lastOpenedTab", cleanPath);
    };

    // V0.9.10: 监听通知系统的导航请求
    useEffect(() => {
        const subscription = EventBus.on<string>(
            "UI_NAVIGATE_REQUEST",
            (path) => {
                console.debug("[Engram] 收到导航请求:", path);
                handleNavigate(path);
            },
        );

        const handleWindowNavigate = (event: Event) => {
            const path = (event as CustomEvent<string>).detail;
            console.debug("[Engram] 收到窗口导航请求:", path);
            if (path) {
                handleNavigate(path);
            }
        };

        globalThis.addEventListener(
            "engram:navigate",
            handleWindowNavigate as EventListener,
        );
        return () => {
            subscription.unsubscribe();
            globalThis.removeEventListener(
                "engram:navigate",
                handleWindowNavigate as EventListener,
            );
        };
    }, []);

    const renderContent = () => {
        // 解析路径，支持 page:subtab[:detail] 格式（如 devlog:model, presets:prompt:macros）
        const [page, ...subtabParts] = activeTab.split(":");
        const subtab = subtabParts.join(":") || undefined;

        switch (page) {
            case "dashboard": {
                return <Dashboard onNavigate={handleNavigate} />;
            }
            case "presets": {
                return (
                    <APIPresets
                        onNavigate={handleNavigate}
                        initialTab={subtabParts[0] as
                            | "model"
                            | "prompt"
                            | "regex"
                            | "worldbook"
                            | undefined}
                        initialTabPath={subtab}
                    />
                );
            }
            case "devlog": {
                return <DevLog initialTab={subtab as "runtime" | "model"} />;
            }
            case "settings": {
                return <Settings />;
            }
            case "memory": {
                return <MemoryStream
                    initialTab={subtab as "list" | "entities" | undefined}
                />;
            }
            case "processing": {
                return <ProcessingView
                    onNavigate={handleNavigate}
                    initialTab={subtab as
                        | "summary"
                        | "vectorization"
                        | "recall"
                        | "entity"
                        | undefined}
                />;
            }
            default: {
                return <Dashboard onNavigate={handleNavigate} />;
            }
        }
    };

    return (
        <MainLayout
            activeTab={activeTab}
            setActiveTab={handleNavigate}
            onClose={onClose}
        >
            {renderContent()}
        </MainLayout>
    );
};

export default App;
