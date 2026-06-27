import React from "react";
import { useConfigStore } from "@/state/configStore.ts";
import { Switch } from "@/ui/components/form/Switch.tsx";
import { ShieldCheck } from "lucide-react";

/**
 * FeaturesTab — 预览与审核总控。
 *
 * V2.1: 统一摄取后，summary 与 entity 共享一个预览开关
 * (ingestionConfig.previewEnabled)。原先两个独立开关合并为一个。
 */
export const FeaturesTab: React.FC = () => {
    const {
        ingestionConfig,
        globalPreviewEnabled,
        updateConfig,
    } = useConfigStore();

    const previewEnabled = ingestionConfig?.previewEnabled ?? true;

    return (
        <div className="space-y-8">
            {/* 全局控制 */}
            <section>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
                    预览与审核总控
                </h3>
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="p-2 rounded-lg bg-primary text-primary-foreground flex-shrink-0">
                                <ShieldCheck size={20} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h4 className="font-medium text-heading truncate">
                                    启用预览修订模式 (全局)
                                </h4>
                                <p className="text-sm text-meta line-clamp-2">
                                    总开关。关闭后将跳过所有自动触发的修订窗口
                                </p>
                            </div>
                        </div>
                        <Switch
                            checked={globalPreviewEnabled}
                            onChange={(checked) =>
                                updateConfig("globalPreviewEnabled", checked)}
                        />
                    </div>
                </div>
            </section>

            <section>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                        自动触发审核项
                    </h3>
                    {!globalPreviewEnabled && (
                        <span className="text-[10px] bg-red-500/10 text-red-500 px-2 py-0.5 rounded border border-red-500/20">
                            已由全局开关禁用
                        </span>
                    )}
                </div>

                <div className="space-y-3">
                    {/* 统一摄取预览（summary + entity 共享） */}
                    <div className="bg-muted/30 border border-border rounded-lg p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="p-2 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                                    <ShieldCheck size={20} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h4 className="font-medium text-heading truncate">
                                        摄取修订模式
                                    </h4>
                                    <p className="text-sm text-meta line-clamp-2">
                                        摄取 pass（摘要 + 实体）写入前，弹出预览窗口
                                    </p>
                                </div>
                            </div>
                            <Switch
                                disabled={!globalPreviewEnabled}
                                checked={previewEnabled}
                                onChange={(checked) => {
                                    if (!ingestionConfig) return;
                                    updateConfig("ingestionConfig", {
                                        ...ingestionConfig,
                                        previewEnabled: checked,
                                    });
                                }}
                            />
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
};
