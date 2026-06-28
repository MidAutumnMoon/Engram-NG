/**
 * SillyTavern 世界书扫描器内部入口。
 *
 * `checkWorldInfo` / `getSortedEntries` 既不在 `window.SillyTavern` 稳定上下文里，
 * 也不在 JS-Slash-Runner 的宿主函数层 —— 唯一的访问途径是直接 import 酒馆自带的
 * `/scripts/world-info.js` 模块。该路径是酒馆在运行时提供的绝对 URL，因此用
 * `@vite-ignore` 阻止 Vite 在构建期尝试解析它。重复 import 是廉价的：浏览器模块
 * 注册表在首次求值后即缓存命名空间。
 *
 * 这里只暴露域层需要的两个薄包装；导入失败与函数缺失统一归约为 `null`，由调用方
 * 走各自的常驻条目回退。
 */

/** ST 内部 WIEntry 的读子集。ST 用 `disable`（`enabled` 的反值）。 */
export interface StWorldInfoEntry {
    uid: number;
    /** 所属世界书名。ST 加载条目时写入（`entry.world = file`）。 */
    world?: string;
    content: string;
    constant?: boolean;
    disable?: boolean;
    order?: number;
    /** Engram 在自建条目上打 `{ engram: true }` 标记；ST 原生条目无此字段。 */
    extra?: { engram?: boolean } & Record<string, unknown>;
}

/** ST `checkWorldInfo` 的返回结构。 */
export interface WiActivated {
    worldInfoBefore: string;
    worldInfoAfter: string;
    WIDepthEntries: StWorldInfoEntry[];
    EMEntries: StWorldInfoEntry[];
    ANBeforeEntries: StWorldInfoEntry[];
    ANAfterEntries: StWorldInfoEntry[];
    outletEntries: Record<string, string[]>;
    /** 本次扫描激活的全部条目。 */
    allActivatedEntries: Set<StWorldInfoEntry>;
}

/** `/scripts/world-info.js` 导出中我们关心的部分（均可能缺失，故运行时 typeof 校验）。 */
interface WorldInfoModule {
    getSortedEntries?: () => Promise<StWorldInfoEntry[]>;
    checkWorldInfo?: (
        chat: string[],
        maxContext: number,
        isDryRun: boolean,
        globalScanData?: { trigger?: string },
    ) => Promise<WiActivated>;
}

// N.B. This assumes SillyTavern instance is served directly under
// the root path, i.e. "https://domain.tld/sillytavern/" will break
// the dynamic import.
const WORLD_INFO_PATH = "/scripts/world-info.js";

async function load(): Promise<WorldInfoModule | null> {
    try {
        // Runtime only, can't do type checking properly.
        const mod = await import(/* @vite-ignore */ WORLD_INFO_PATH);
        return mod as unknown as WorldInfoModule;
    } catch {
        return null;
    }
}

/**
 * 获取已排序的世界书条目。
 * @returns 条目数组；ST 模块不可用时返回 null。
 */
export async function getSortedEntries(): Promise<StWorldInfoEntry[] | null> {
    const mod = await load();
    return typeof mod?.getSortedEntries === "function"
        ? mod.getSortedEntries()
        : null;
}

/**
 * 对给定消息执行酒馆原生世界书扫描。
 * @returns 激活条目集合；ST 模块不可用时返回 null。
 */
export async function checkWorldInfo(
    chat: string[],
    maxContext: number,
    isDryRun: boolean,
    globalScanData: { trigger?: string },
): Promise<WiActivated | null> {
    const mod = await load();
    return typeof mod?.checkWorldInfo === "function"
        ? mod.checkWorldInfo(chat, maxContext, isDryRun, globalScanData)
        : null;
}
