/**
 * DataView - 数据维护
 *
 * 从原 Settings DataTab 抽出：联动删除、全局数据库列表、当前聊天重置/删库。
 * 这些是数据维护操作，与「设置」（全局开关）解耦。
 */

import { RefreshCw, Trash2 } from "lucide-react";
import React, { useState } from "react";
import { PageTitle } from "@/ui/components/display/PageTitle.tsx";
import { Switch } from "@/ui/components/form/Switch.tsx";
import { useConfigStore } from "@/state/configStore.ts";
import { useMemoryStore } from "@/state/memoryStore.ts";
import { getCurrentChatId } from "@/sillytavern/context.ts";
import { GlobalDatabaseList } from "@/ui/views/settings/components/GlobalDatabaseList.tsx";

export const DataView: React.FC = () => {
    const memoryStore = useMemoryStore();
    const { linkedDeletion, updateConfig } = useConfigStore();
    const [, forceUpdate] = useState({});

    const handleLinkedDeletionChange =
        (key: keyof typeof linkedDeletion) => (checked: boolean) => {
            updateConfig(
                "linkedDeletion",
                { ...linkedDeletion, [key]: checked } as any,
            );
        };

    const handleReset = async () => {
        const chatId = getCurrentChatId();
        if (!chatId) {
            alert("未连接到聊天");
            return;
        }

        if (
            confirm(
                "确定要清空当前聊天的 IndexedDB 数据吗？\n警告：这将删除所有记忆、实体和总结！数据库文件保留。",
            )
        ) {
            if (confirm("再次确认：此操作不可逆！")) {
                try {
                    await memoryStore.clearChatDatabase();
                    alert("重置成功");
                    forceUpdate({});
                } catch (error) {
                    alert("重置失败: " + error);
                }
            }
        }
    };

    const handleDelete = async () => {
        const chatId = getCurrentChatId();
        if (!chatId) {
            alert("未连接到聊天");
            return;
        }

        if (
            confirm(
                "确定要彻底删除当前聊天的数据库文件吗？\n警告：这将完全移除 Engram 为此聊天存储的所有数据！",
            )
        ) {
            if (confirm("再次确认：这相当于完全卸载此聊天的记忆模块！")) {
                try {
                    await memoryStore.deleteChatDatabase();
                    alert("删除成功");
                    forceUpdate({});
                } catch (error) {
                    alert("删除失败: " + error);
                }
            }
        }
    };

    return (
        <div className="flex flex-col h-full gap-2">
            <PageTitle
                title="数据维护"
                subtitle="本地数据库与联动清理"
            />

            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
                <section>
                    <div className="bg-muted/30 border border-border rounded-lg p-4 space-y-4">
                        {/* 联动删除 */}
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="p-2 rounded-lg bg-red-500/10 text-red-500 flex-shrink-0">
                                    <Trash2 size={20} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h4 className="font-medium text-foreground truncate">
                                        联动删除
                                    </h4>
                                    <p className="text-sm text-muted-foreground line-clamp-2">
                                        删除角色/聊天时，自动清理记忆库
                                    </p>
                                </div>
                            </div>
                            <Switch
                                checked={linkedDeletion?.enabled ?? false}
                                onChange={handleLinkedDeletionChange(
                                    "enabled",
                                )}
                            />
                        </div>

                        {(linkedDeletion?.enabled) && (
                            <div className="pl-14 space-y-3 border-t border-border pt-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-muted-foreground">
                                        删除前确认
                                    </span>
                                    <Switch
                                        checked={linkedDeletion
                                            .showConfirmation ?? true}
                                        onChange={handleLinkedDeletionChange(
                                            "showConfirmation",
                                        )}
                                        className="scale-90"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 数据库全局管理 */}
                    <div className="mt-4">
                        <GlobalDatabaseList />
                    </div>

                    <div className="bg-muted/30 border border-border rounded-lg p-4 mt-4 space-y-4">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="p-2 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                                    <RefreshCw size={20} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h4 className="font-medium text-heading truncate">
                                        当前聊天维护
                                    </h4>
                                    <p className="text-sm text-meta line-clamp-2">
                                        手动清空或删除【当前打开库】的数据库及数据
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="pl-14 flex gap-4">
                            <button
                                type="button"
                                onClick={handleReset}
                                className="px-3 py-1.5 text-xs font-medium rounded-md bg-background border border-border hover:bg-muted text-yellow-600"
                            >
                                重置当前数据 (保留DB)
                            </button>
                            <button
                                type="button"
                                onClick={handleDelete}
                                className="px-3 py-1.5 text-xs font-medium rounded-md bg-background border border-border hover:bg-red-500/10 text-red-600"
                            >
                                删除当前库 (删库)
                            </button>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};
