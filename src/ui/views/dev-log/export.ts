/**
 * DevLog 导出工具
 *
 * 从原 Logger.exportToMarkdown / getExportFilename 迁移而来——
 * 导出格式化属于 UI 关注点，不应在日志核心层。
 */

import manifest from "../../../../manifest.json" with { type: "json" };
import { Logger, LogLevelConfig } from "@/core/logger/index.ts";

/**
 * 格式化时间戳为 HH:MM:SS
 */
function formatTime(timestamp: number): string {
    return new Date(timestamp).toTimeString().slice(0, 8);
}

/**
 * 序列化 data 字段，捕获循环引用等异常
 */
function safeStringify(data: unknown): string {
    try {
        return JSON.stringify(data, null, 2)
            .split("\n")
            .map((line) => `    ${line}`)
            .join("\n");
    } catch {
        return "    [Data serialization failed]";
    }
}

/**
 * 将日志导出为 Markdown 字符串。
 * 迭代前先做快照，避免导出过程中新日志写入造成不一致。
 */
export function exportLogsToMarkdown(): string {
    const now = new Date();
    const snapshot = Logger.getLogs();

    let md = `# Engram Debug Log\n\n`;
    md += `- **导出时间**: ${now.toLocaleString("zh-CN")}\n`;
    md += `- **版本**: ${manifest.version}\n`;
    md += `- **日志条数**: ${snapshot.length}\n\n`;
    md += `---\n\n`;
    md += `## 日志记录\n\n`;
    md += "```markdown\n";

    for (const entry of snapshot) {
        const time = formatTime(entry.timestamp);
        const level = LogLevelConfig[entry.level].label.padEnd(7);
        const mod = entry.module.padEnd(16);
        md += `[${time}] [${mod}] ${level} ${entry.message}\n`;

        if (entry.data !== undefined) {
            md += `${safeStringify(entry.data)}\n`;
        }
    }

    md += "```\n";
    return md;
}

/**
 * 生成导出文件名
 * 格式: engram_log_YYYY-MM-DD_HHMMSS.md
 */
export function getExportFilename(): string {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8).replaceAll(/:/g, "");
    return `engram_log_${dateStr}_${timeStr}.md`;
}
