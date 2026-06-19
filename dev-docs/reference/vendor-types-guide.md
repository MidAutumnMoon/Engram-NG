# SillyTavern / JS-Slash-Runner TypeScript 类型指南

New extension project 起步参考。记录集成 SillyTavern (ST) 与 JS-Slash-Runner (JSR) 类型时踩过的坑与解法。

---

## TL;DR — 新项目起步清单

1. 将 ST 与 JSR 作为 git submodule 放入 `vendor/`。
2. 在 `deno.jsonc` 的 `exclude` 里加入 `"vendor"`，避免 lint/format 扫描。
3. 用 bundler 脚本（见下文）将 JSR `@types/function/*` 合并成模块；**输出提交到源码树**（如 `src/types/vendor/jsr-function.d.ts`）。
4. `global.d.ts` 中 `/// <reference>` JSR 的 `exported.sillytavern.d.ts`、`exported.mvu.d.ts`、`exported.ejstemplate.d.ts`、`event.d.ts`。
5. 手写 Window augmentation，补齐 `SillyTavern`、`Mvu`、`EjsTemplate` 等。
6. 引入 `@types/jquery`（triple-slash reference）与 `type-fest`（global namespace shim）。
7. 用 throwaway type probe（见下文）验证关键全局类型可解析后删除。

---

## 1. 核心问题：ambient 脚本 vs 模块

JSR 的 `@types/function/index.d.ts` 是 ambient script（无 `import`/`export`），且通过裸 `typeof playAudio` 引用同目录 sibling 文件。直接 `/// <reference types=".../index.d.ts" />` 会产生两个问题：

- **Sibling 无法解析**：单个 reference 只加载 `index.d.ts` 本身，`audio.d.ts`、`character.d.ts` 等不会进入 program graph，`typeof playAudio` 报 `Cannot find name`。
- **全局污染**：所有 `declare function` 作为 bare global 泄漏，导致 `playAudio(...)` 全项目自动补全，但运行时只有 `window.TavernHelper.playAudio` 存在。

### 解法：bundler 脚本

参考 `scripts/bundle_vendor_types.ts`。核心逻辑：

1. 拼接所有 sibling `.d.ts` 内容为模块 body。
2. 抽取 triple-slash reference 到文件顶部。
3. `export {}` 将整体转为 isolated module（scope 住所有 ambient 声明）。
4. `index.d.ts` 的 `interface Window { TavernHelper: ... }` 用 `declare global { ... }` 包裹，让 Window augmentation 生效。

**关键约束**：vendor 目录只读，输出写到 `src/types/vendor/` 并提交。bump submodule 后手动 `deno task gen:types` 重新生成。

### 为什么不用其他方案

- **逐个 `/// <reference>` sibling**：能解析 typeof，但无法解决全局污染。
- **gitignore 输出 + 链入 build**：IDE/tsserver 在首次 build 前无类型，DX 差。
- **改 vendor 文件**：submodule，bump 即丢失。

---

## 2. Vendor 类型文件清单（JSR `@types/`）

| 路径 | 内容 | 自包含 | 处理方式 |
|---|---|---|---|
| `function/index.d.ts` | `window.TavernHelper` 聚合接口 | ❌ 依赖 sibling typeof | **bundle** |
| `function/*.d.ts` | 各 API 的 `declare function` 与类型 | ✅ | bundle 输入 |
| `iframe/exported.sillytavern.d.ts` | ST 上下文形状（**不是** ST 全局） | ✅ | 直接 reference |
| `iframe/exported.mvu.d.ts` | Mvu 变量框架插件 | ✅ | 直接 reference |
| `iframe/exported.ejstemplate.d.ts` | EjsTemplate 模板插件 | ✅ | 直接 reference |
| `iframe/event.d.ts` | `eventOn`/`eventTypes` 等事件 API | ✅ | 直接 reference |

### `exported.sillytavern.d.ts` 的命名陷阱

JSR 将 **ST 上下文形状**（ST `st-context.ts` 的返回）命名为 `SillyTavern`，因为 iframe 脚本主要与 context 交互。所以：

```ts
declare const SillyTavern: {
    readonly chat: ChatMessage[];      // ← context 字段
    readonly name1: string;            // ← context 字段
    // ...
};
```

**`typeof SillyTavern` 就是 `getContext()` 的返回类型**。无需手写 `StContext` interface。这让你可以一行搞定 Window augmentation：

```ts
interface Window {
    SillyTavern: { getContext: () => typeof SillyTavern };
}
```

---

## 3. Ambient global vs Window 的鸿沟

ST 与 JSR 的 `declare const X` / `declare var X` 只创建 bare global 标识符，**不**自动加入 `Window` interface。运行时 `X` 与 `window.X` 都能访问，但类型层面 `window.X` 报 `Property 'X' does not exist on type 'Window'`。

### 受影响的全局

| 全局 | 来源 | Window augmentation |
|---|---|---|
| `SillyTavern` | JSR `exported.sillytavern.d.ts` | 非可选（宿主，必然存在） |
| `Mvu` | JSR `exported.mvu.d.ts` | `?` 可选（用户需安装插件） |
| `EjsTemplate` | JSR `exported.ejstemplate.d.ts` | `?` 可选 |

### 访问方式不对称

通过 augmentation 后：

- `window.SillyTavern.getContext()` → ✅ 类型正确
- `SillyTavern.getContext()` → ❌ 报错（bare `SillyTavern` 解析为 JSR 的 context 形状，无 `getContext`）
- `globalThis.SillyTavern.getContext()` → ❌ 同上

**统一用 `window.` 前缀**。`deno.jsonc` 的 lint 规则已排除 `no-window`。

---

## 4. 第三方类型依赖

### `@types/jquery`

JSR 类型中 `JQuery<HTMLElement>` 作为 ambient global 出现。Deno **不自动发现 `@types/*`**（无 `typeRoots`），需要显式 triple-slash：

```ts
/// <reference types="npm:@types/jquery" />
```

### `type-fest`

`type-fest` 是纯 ESM（`export type * from …`），**无全局命名空间**。但 JSR 的 vendor `.d.ts` 使用 `TypeFest.LiteralUnion` 这类裸命名空间引用，无法直接解析。需要 shim 将用到的成员 re-alias 到全局命名空间：

```ts
// src/types/type-fest-global.d.ts
import type {
    LiteralUnion as TF_LiteralUnion,
    PartialDeep as TF_PartialDeep,
    PartialDeepOptions,
    Primitive,
    SetRequired as TF_SetRequired,
} from "type-fest";

declare global {
    namespace TypeFest {
        type LiteralUnion<LiteralType, BaseType extends Primitive = string> = TF_LiteralUnion<LiteralType, BaseType>;
        type PartialDeep<T, Options extends PartialDeepOptions = {}> = TF_PartialDeep<T, Options>;
        type SetRequired<BaseType, Keys extends keyof BaseType> = TF_SetRequired<BaseType, Keys>;
    }
}

export {};
```

import alias（`TF_*`）避免命名空间内 `LiteralUnion` 自引用遮蔽。JSR 的 `tsconfig.types.json` 确认这是上游假设：它声明 `"types": ["jquery"]` 但**不**含 type-fest，依赖下游 consumer 提供两者。

---

## 5. Deno 特有陷阱

### `exclude` 对 `deno check` 无效（被 reference 拉入时）

`deno.jsonc` 的 `exclude` 只控制文件**自动发现**。一旦 `global.d.ts` 用 `/// <reference types="./vendor/..." />`，vendor 文件被强制拉入 program graph，`exclude` 不再生效。

### `skipLibCheck` 不被支持

标准 TS 跳过 `.d.ts` 检查的选项在 Deno 中被忽略（见 [denoland/deno#21855](https://github.com/denoland/deno/issues/21855)）。Deno 默认不检查 *remote/npm* 依赖，但本地 `vendor/` 被视为你的程序。

### `deno task build` 不做类型检查

Vite/esbuild 只转译。**build 通过 ≠ 类型正确**。需用 LSP diagnostics 或 throwaway probe 验证。

### `deno check <单文件>` 不自动加载 `global.d.ts`

单文件 check 只看该文件。验证全局类型时需在 probe 文件顶部加：

```ts
/// <reference types="../../global.d.ts" />
```

---

## 6. 类型化后浮现的真实 Bug（前车之鉴）

之前 `getContext()` 返回 `any`，掩盖了大量实际 bug。类型化后浮现的 pattern：

### Snake_case vs camelCase

ST 的 context 对象统一用 **camelCase**，但代码中残留 snake_case 访问（始终返回 `undefined`）：

| 错误（运行时 undefined） | 正确 |
|---|---|
| `context.chat_metadata` | `context.chatMetadata` |
| `context.event_types` | `context.eventTypes` |

来源：ST `st-context.js` 中 `chatMetadata: chat_metadata`（内部 snake → 导出 camel）。

### string vs number

ST 的 ID 类字段是**数字字符串**（如 `"505"`），不是 number：

| 错误 | 正确 |
|---|---|
| `characterId !== -1`（永远真，类型不匹配） | `!!characterId` 或 `characterId !== ""` |
| `data: { id: number }`（事件回调） | `data: { id: string }` |

### 不存在的事件名

`GROUP_CHAT_DELETED` 在 JSR 的 `tavern_events` 中不存在（只有 `CHAT_DELETED`）。对应代码分支是死代码。**不要假设事件存在，用 JSR `event.d.ts` 核对**。

### 死的 `@ts-expect-error`

修好底层类型问题后，原本抑制错误的 `@ts-expect-error` 会变成 "Unused directive" 报错。清理它们。

---

## 7. 验证工作流：throwaway type probe

不依赖完整 `deno check`（vendor 噪音大），用临时 probe 文件精确验证：

```ts
// src/types/_probe.ts — 验证后删除
/// <reference types="../../global.d.ts" />

const helper = window.TavernHelper;        // bundled types
helper.getAudioList;                        // sibling typeof 解析

window.SillyTavern.getContext().chat;       // Window augmentation + context 形状
window.Mvu?.events.VARIABLE_UPDATE_ENDED;   // 可选插件
window.EjsTemplate?.evaltemplate;

const x: JQuery<HTMLElement> = null!;       // jquery ambient
const y: TypeFest.LiteralUnion<"a", string> = "a"; // type-fest shim

export {};
```

`deno check src/types/_probe.ts` 通过即说明所有 glue 生效。验证后删除。

---

## 8. 维护策略

### Staleness

JSR 的 `@types/` 是**手动维护**的，可能滞后于最新 ST API。ST 不做 breaking change，所以风险是**增量**的（漏掉新 API），不是破坏性的。

- bump JSR submodule 后：`deno task gen:types` 重新生成 bundle。

### 不要

- ❌ 修改 vendor 文件（submodule，bump 丢失）。
- ❌ gitignore bundle 输出（IDE/build 前无类型）。
- ❌ 逐个 reference sibling（全局污染）。
- ❌ 手写完整的 `StContext` interface（`typeof SillyTavern` 已覆盖）。
- ❌ 依赖 `deno task build` 判断类型正确性（不做检查）。
