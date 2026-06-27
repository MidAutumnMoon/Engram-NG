/**
 * UseLLMPresets - LLM 预设管理
 *
 * Prompt templates are built-in only (see `@/integrations/llm/builtinPrompts.ts`)
 * and no longer part of the persisted LLM settings, so this hook is presets-only.
 */

import {
    createDefaultLLMPreset,
    getDefaultAPISettings,
} from "@/config/settings.ts";
import type { EngramAPISettings } from "@/config/settings.ts";
import { getSetting, setSetting } from "@/config/settings.ts";
import type { LLMPreset } from "@/config/types/llm.ts";
import { useCallback, useEffect, useState } from "react";

export interface UseLLMPresetsReturn {
    llmPresets: LLMPreset[];
    selectedPresetId: string | null;
    editingPreset: LLMPreset | null;
    hasChanges: boolean;

    // 预设操作
    selectPreset: (preset: LLMPreset) => void;
    addPreset: () => void;
    updatePreset: (preset: LLMPreset) => void;
    copyPreset: (preset: LLMPreset) => void;
    deletePreset: (preset: LLMPreset) => void;

    // 保存
    saveLLMSettings: () => void;
}

export function useLLMPresets(): UseLLMPresetsReturn {
    const [settings, setSettings] = useState<EngramAPISettings>(
        getDefaultAPISettings,
    );
    const [editingPreset, setEditingPreset] = useState<LLMPreset | null>(null);
    const [hasChanges, setHasChanges] = useState(false);

    // 加载配置
    useEffect(() => {
        const savedAPISettings = getSetting("apiSettings");
        if (savedAPISettings) {
            const defaultSettings = getDefaultAPISettings();
            setSettings({
                ...defaultSettings,
                ...savedAPISettings,
                llmPresets: savedAPISettings.llmPresets?.length > 0
                    ? savedAPISettings.llmPresets
                    : defaultSettings.llmPresets,
                selectedPresetId: savedAPISettings.selectedPresetId ||
                    defaultSettings.selectedPresetId,
            });
        }
    }, []);

    const selectPreset = useCallback((preset: LLMPreset) => {
        setSettings((prev) => ({ ...prev, selectedPresetId: preset.id }));
        setEditingPreset(preset);
        setHasChanges(true);
    }, []);

    const addPreset = useCallback(() => {
        const newPreset = createDefaultLLMPreset(
            `预设 ${settings.llmPresets.length + 1}`,
        );
        newPreset.isDefault = false;
        setSettings((prev) => ({
            ...prev,
            llmPresets: [...prev.llmPresets, newPreset],
            selectedPresetId: newPreset.id,
        }));
        setEditingPreset(newPreset);
        setHasChanges(true);
    }, [settings.llmPresets.length]);

    const updatePreset = useCallback((updated: LLMPreset) => {
        setSettings((prev) => ({
            ...prev,
            llmPresets: prev.llmPresets.map((p) =>
                p.id === updated.id ? updated : p
            ),
        }));
        setEditingPreset(updated);
        setHasChanges(true);
    }, []);

    const copyPreset = useCallback((preset: LLMPreset) => {
        const copy: LLMPreset = {
            ...preset,
            createdAt: Date.now(),
            id: `preset_${Date.now()}`,
            isDefault: false,
            name: `${preset.name} (副本)`,
            updatedAt: Date.now(),
        };
        setSettings((prev) => ({
            ...prev,
            llmPresets: [...prev.llmPresets, copy],
        }));
        setHasChanges(true);
    }, []);

    const deletePreset = useCallback((preset: LLMPreset) => {
        if (preset.isDefault) return;
        setSettings((prev) => ({
            ...prev,
            llmPresets: prev.llmPresets.filter((p) => p.id !== preset.id),
            selectedPresetId: prev.selectedPresetId === preset.id
                ? null
                : prev.selectedPresetId,
        }));
        setEditingPreset((current) =>
            current?.id === preset.id ? null : current
        );
        setHasChanges(true);
    }, []);

    const saveLLMSettings = useCallback(() => {
        // 仅保存 LLM 相关设置，保留其他设置
        const currentSettings = getSetting("apiSettings") ??
            getDefaultAPISettings();
        setSetting("apiSettings", {
            ...currentSettings,
            llmPresets: settings.llmPresets,
            selectedPresetId: settings.selectedPresetId,
        });
        setHasChanges(false);
    }, [settings]);

    return {
        addPreset,
        copyPreset,
        deletePreset,
        editingPreset,
        hasChanges,
        llmPresets: settings.llmPresets,
        saveLLMSettings,
        selectPreset,
        selectedPresetId: settings.selectedPresetId,
        updatePreset,
    };
}
