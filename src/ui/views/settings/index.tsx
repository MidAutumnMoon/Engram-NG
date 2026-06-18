import React, { useState } from "react";
import { PageTitle } from "@/ui/components/display/PageTitle";
import { TabPills } from "@/ui/components/layout/TabPills";

// Tabs
import { AppearanceTab } from "./tabs/AppearanceTab";
import { FeaturesTab } from "./tabs/FeaturesTab";
import { DataTab } from "./tabs/DataTab";

type SettingsTabType = "appearance" | "features" | "data";

export const Settings: React.FC = () => {
    const [activeTab, setActiveTab] = useState<SettingsTabType>("appearance");

    return (
        <div className="flex flex-col h-full">
            <PageTitle
                breadcrumbs={["设置"]}
                title="全局选项"
                subtitle="扩展全局选项与数据维护"
                className="mb-2"
            />

            <TabPills
                tabs={[
                    { id: "appearance", label: "外观" },
                    { id: "features", label: "功能" },
                    { id: "data", label: "数据管理" },
                ]}
                activeTab={activeTab}
                onChange={(id: string) => setActiveTab(id as SettingsTabType)}
            />

            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                {activeTab === "appearance" && <AppearanceTab />}
                {activeTab === "features" && <FeaturesTab />}
                {activeTab === "data" && <DataTab />}
            </div>
        </div>
    );
};
