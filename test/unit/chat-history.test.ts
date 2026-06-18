import { beforeEach, describe, expect, it, vi } from "vitest";

// 必须在任何业务代码导入之前进行 Mock
vi.mock("@/core/logger", () => ({
    Logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        success: vi.fn(),
    },
    LogModule: {
        TAVERN: "TAVERN",
    },
}));

vi.mock("@/config/settings", () => ({
    SettingsManager: {
        get: vi.fn((key) => {
            if (key === "summarizerConfig") return { floorInterval: 2 };
            return {};
        }),
    },
}));

import { ChatHistoryHelper } from "@/sillytavern/chat/chatHistory";

describe("ChatHistoryHelper Unit Tests", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // 重置全局环境中的 chat 数据
        // 注意：ST 内部消息通常不带角色前缀，除非在导出时手动拼接
        (global as any).window.SillyTavern.getContext.mockReturnValue({
            chat: [
                { name: "System", mes: "Msg 0" }, // Index 0
                { name: "User", mes: "Msg 1" }, // Index 1
                { name: "Char", mes: "Msg 2" }, // Index 2
                { name: "User", mes: "Msg 3" }, // Index 3
                { name: "Char", mes: "Msg 4" }, // Index 4
                { name: "User", mes: "Msg 5" }, // Index 5
            ],
        });
    });

    describe("getChatHistory", () => {
        it("should correctly slice history within valid range [1, 3]", () => {
            const result = ChatHistoryHelper.getChatHistory([1, 3]);
            // 预期：Msg 0 (ST index 1), Msg 1, Msg 2 (根据目前的实现，ST floor 1 对应索引 0)
            expect(result).toContain("Msg 0");
            expect(result).toContain("Msg 1");
            expect(result).toContain("Msg 2");
            expect(result).not.toContain("Msg 3");
        });

        it("should handle floor 0 and fix it to 1", () => {
            // 验证当传入 0 时，是否被强制修正为从 1 (索引 0) 开始
            const result = ChatHistoryHelper.getChatHistory([0, 2]);
            expect(result).toContain("Msg 0");
            expect(result).toContain("Msg 1");
            expect(result).not.toContain("Msg 5");
        });

        it("should handle out-of-bounds endFloor and clip to chat length", () => {
            const result = ChatHistoryHelper.getChatHistory([4, 999]);
            // 预期：Msg 3 (floor 4 -> index 3), Msg 4, Msg 5
            expect(result).toContain("Msg 3");
            expect(result).toContain("Msg 4");
            expect(result).toContain("Msg 5");
            expect(result.split("\n").filter((l) => l.trim()).length).toBe(3);
        });

        it("should return empty string if startFloor > chat length", () => {
            const result = ChatHistoryHelper.getChatHistory([10, 20]);
            expect(result).toBe("");
        });

        it("should apply dynamic limit when no range is provided", () => {
            const result = ChatHistoryHelper.getChatHistory();
            // 预期：最后两条 Msg 4, Msg 5 (因为 mock 限制为 2)
            expect(result).toContain("Msg 4");
            expect(result).toContain("Msg 5");
            expect(result).not.toContain("Msg 3");
        });
    });

    describe("getCurrentMessageCount", () => {
        it("should return the correct number of messages (excluding first system message if needed)", () => {
            const count = ChatHistoryHelper.getCurrentMessageCount();
            expect(count).toBe(6);
        });
    });
});
