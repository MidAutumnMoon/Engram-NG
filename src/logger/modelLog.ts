import { create } from "zustand";
import { generateShortUUID } from "@/utils/index.ts";

export interface ModelLogEntry {
    id: string;
    timestamp: number;
    type:
        | "summarize"
        | "trim"
        | "vectorize"
        | "query"
        | "entity_extraction"
        | "other"
        | "generation";
    direction: "sent" | "received";

    systemPrompt?: string;
    userPrompt?: string;
    tokensSent?: number;
    response?: string;
    tokensReceived?: number;

    status: "pending" | "success" | "error" | "cancelled";
    error?: string;
    duration?: number;

    model?: string;
    character?: string;
    floorRange?: [number, number];
}

export interface ModelLogPair {
    sent: ModelLogEntry;
    received?: ModelLogEntry;
}

interface ModelLogState {
    pairs: ModelLogPair[];
    logSend: (data: {
        type: ModelLogEntry["type"];
        systemPrompt?: string;
        userPrompt?: string;
        tokensSent?: number;
        model?: string;
        character?: string;
        floorRange?: [number, number];
    }) => string;
    logReceive: (
        id: string,
        data: {
            response?: string;
            tokensReceived?: number;
            status: "success" | "error" | "cancelled";
            error?: string;
            duration?: number;
        },
    ) => void;
    clear: () => void;
}

export const useModelLogStore = create<ModelLogState>((set) => ({
    pairs: [],

    logSend: (data) => {
        const id = generateShortUUID("model_");
        set((s) => ({
            pairs: [
                {
                    sent: {
                        id,
                        timestamp: Date.now(),
                        direction: "sent",
                        status: "pending",
                        ...data,
                    },
                },
                ...s.pairs,
            ],
        }));
        return id;
    },

    logReceive: (id, data) =>
        set((s) => ({
            pairs: s.pairs.map((p) =>
                p.sent.id === id
                    ? {
                        ...p,
                        received: {
                            ...data,
                            id,
                            timestamp: Date.now(),
                            direction: "received",
                            type: p.sent.type,
                        },
                    }
                    : p
            ),
        })),

    clear: () => set({ pairs: [] }),
}));
