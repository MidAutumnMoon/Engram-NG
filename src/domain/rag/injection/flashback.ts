/**
 * flashback - 召回锚点判定的纯函数
 *
 * 把「召回事件是否构成 flashback」从 Injector 的 I/O 逻辑中剥离出来，
 * 让它可被 deno test 直接覆盖，无需 mock SillyTavern context / React。
 *
 * 注入路径（Injector）读取提取前沿（last_processed_floor）后调用此函数，
 * 决定是否把实体状态 as-of 渲染锚定到召回事件的 end_index。
 */

/**
 * 锚定阈值：top 召回事件距前沿至少多少条消息才视为 flashback。
 * 10 条 ≈ 一两轮对话，保证普通「当前状态」查询不被误锚定。
 */
export const FLASHBACK_MIN_DISTANCE = 10;

/**
 * 判断召回事件是否构成 flashback，若是返回其作为状态锚点的 end_index。
 *
 * 半开语义：topEndIndex <= frontier - minDistance 即锚定（边界归属于锚定）。
 *
 * 为什么基准是 frontier（last_processed_floor）而不是 chat.length：
 * chat.length 包含缓冲区内尚未提取的消息，frontier 是「记忆已写到哪」的真实位置。
 * 用 chat.length 会让阈值随 bufferSize 偏移——默认 bufferSize=10 时，
 * 召回命中前沿本身就已经满足 chat.length - 10，误把「刚提取过」当 flashback。
 * 用 frontier 把阈值修正为「前沿之前多少条」，与提取节奏对齐。
 *
 * 纯函数——无 I/O、无副作用。
 */
export function computeFlashbackTarget(
    topEndIndex: number | undefined,
    frontier: number,
    minDistance: number = FLASHBACK_MIN_DISTANCE,
): number | undefined {
    if (topEndIndex == null) return undefined;
    return topEndIndex <= frontier - minDistance ? topEndIndex : undefined;
}
