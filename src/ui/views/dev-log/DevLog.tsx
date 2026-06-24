/**
 * DevLog - 开发日志视图
 *
 * Tab 路由：运行日志 / 模型日志 / 召回日志。
 * 各 Tab 自管状态与订阅；本组件只负责切换与页面标题。
 *
 * 应用「无框流体」设计语言：减少卡片边框，工具栏 sticky 固定。
 */

import React, { useState } from "react";
import { Target, Terminal, Zap } from "lucide-react";
import { PageTitle } from "@/ui/components/display/PageTitle.tsx";
import { TabPills } from "@/ui/components/layout/TabPills.tsx";
import { ModelLog } from "./ModelLog.tsx";
import { RecallLog } from "./RecallLog.tsx";
import { RuntimeLogTab } from "./RuntimeLogTab.tsx";

const TABS = [
    {
        id: "runtime",
        label: "运行日志",
        subtitle: "查看系统运行时日志",
        icon: <Terminal size={14} />,
    },
    {
        id: "model",
        label: "模型日志",
        subtitle: "查看 LLM 调用记录",
        icon: <Zap size={14} />,
    },
    {
        id: "recall",
        label: "召回日志",
        subtitle: "查看 RAG 召回记录",
        icon: <Target size={14} />,
    },
] as const;

type TabType = typeof TABS[number]["id"];

interface DevLogProps {
    initialTab?: TabType;
}

export const DevLog: React.FC<DevLogProps> = ({ initialTab }) => {
    const [activeTab, setActiveTab] = useState<TabType>(
        initialTab || "runtime",
    );
    const currentTab = TABS.find((t) => t.id === activeTab) ?? TABS[0];

    return (
        <div className="flex flex-col h-full">
            <PageTitle
                breadcrumbs={["开发日志"]}
                title={currentTab.label}
                subtitle={currentTab.subtitle}
                className="mb-2"
            />

            <TabPills
                tabs={[...TABS]}
                activeTab={activeTab}
                onChange={(id: string) => setActiveTab(id as TabType)}
            />

            {activeTab === "runtime" && <RuntimeLogTab />}

            {activeTab === "model" && (
                <div className="flex-1 overflow-hidden">
                    <ModelLog />
                </div>
            )}

            {activeTab === "recall" && (
                <div className="flex-1 overflow-hidden">
                    <RecallLog />
                </div>
            )}
        </div>
    );
};
