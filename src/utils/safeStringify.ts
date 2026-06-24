/**
 * 安全序列化：处理循环引用、BigInt 等会令 JSON.stringify 抛错的情况。
 *
 * 用于任何接收**未知形状数据**的 JSON.stringify 调用——日志数据、用户编辑的
 * 实体 profile、调试输出等。已知形状的内部对象（fetch payload、自构造结构）
 * 无需经过此函数。
 *
 * @param data 待序列化的值
 * @param indent 缩进空格数；0 表示紧凑单行输出。默认 2
 */
export function safeStringify(data: unknown, indent: number = 2): string {
    const seen = new WeakSet();
    try {
        return JSON.stringify(data, (_key, value) => {
            if (typeof value === "object" && value !== null) {
                if (seen.has(value)) return "[Circular]";
                seen.add(value);
            }
            return value;
        }, indent);
    } catch (err) {
        return `[无法序列化: ${String(err)}]`;
    }
}
