/**
 * 生成语义化短 UUID (例如 evt_A1b2C3)
 * 采用 Base62 字符集，默认 6 位长度，兼顾极短体积与防撞性能。
 * @param prefix 自定义前缀，如 'evt_' 或 'ent_'
 * @param length 随机串长度，默认为 6
 */
export function generateShortUUID(prefix: string, length: number = 6): string {
    const chars =
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let result = prefix;
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
