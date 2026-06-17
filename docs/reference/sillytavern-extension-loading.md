# SillyTavern 扩展加载机制参考

> 本文档基于 SillyTavern vendored 源码（见 `vendor/SillyTavern/`）整理，
> 描述 **第三方扩展（third-party extension）从安装到运行**的完整链路。
> 适合在调整 Engram 的打包 / 安装 / 升级策略、排查"装上但没加载"问题时参考。
>
> 阅读源码时主要参考这两个文件：
>
> - 客户端：`vendor/SillyTavern/public/scripts/extensions.js`
> - 服务端：`vendor/SillyTavern/src/endpoints/extensions.js`

---

## 0. 一句话概览

ST 安装扩展 = 服务端 `git clone --depth 1`；
ST 加载扩展 = 客户端读取 `manifest.json` → 按声明注入 `<script type="module">` + `<link rel="stylesheet">`。
`manifest.html` 字段 ST **不会**自动加载，仅作为元数据存在。

---

## 1. 扩展的三种"类型"与目录布局

服务端 `GET /api/extensions/discover`（`src/endpoints/extensions.js` L480–515）扫描三处目录，并为每个扩展打上类型标签：

| 类型 | 内部前缀 | 磁盘位置 | 谁能安装/删除 |
|------|---------|---------|--------------|
| `system` | （无前缀，直接是目录名） | `public/scripts/extensions/`（除 `third-party/` 子目录） | 随 ST 发行，用户不可卸 |
| `local` | `third-party/` | `<user>/data/.../extensions/third-party/`（用户私有目录） | 当前用户 |
| `global` | `third-party/` | 公共 `extensions/` 全局目录 | 仅 admin |

注意：

- `local` 与 `global` 都使用 `third-party/<name>` 形式的内部名。
- **同名冲突时 `local` 覆盖 `global`**（discover 端点会过滤掉与 local 同名的 global 条目）。
- 客户端到处都有"`third-party` 前缀可有可无"的兼容代码：很多 API 同时接受 `third-party/foo` 与裸 `foo`。

### 静态文件路由

`server-main.js` 通过 `app.use(express.static(path.join(serverDirectory, 'public')))` 把 `public/` 直接挂在站点根。
所以扩展文件的真实 URL 形如：

```
/scripts/extensions/<internalName>/manifest.json
/scripts/extensions/<internalName>/<manifest.js>
/scripts/extensions/<internalName>/<manifest.css>
/scripts/extensions/<internalName>/<任意其它相对路径>
```

`<internalName>` 对第三方扩展而言就是 `third-party/<folderName>`，对系统扩展就是文件夹名本身。

---

## 2. 安装（Install）

### 2.1 客户端入口

`installExtension(url, global, branch = '')`（`public/scripts/extensions.js` L1698）：

1. 校验 URL 必须是 `http:` / `https:`。
2. 对非官方源弹"第三方扩展安全确认"弹窗（可勾选 Don't ask again，状态写入 `accountStorage`）。
3. `POST /api/extensions/install`，body：`{ url, global, branch }`。
4. 成功后：`toastr` 提示、`loadExtensionSettings({}, false, false)` 重扫、emit `EXTENSION_SETTINGS_LOADED`、最后调用扩展的 `install` 钩子（见 §5）。

### 2.2 服务端实现

`POST /api/extensions/install`（`src/endpoints/extensions.js` L92–156）：

```text
1. 权限：global=true 时要求 request.user.profile.admin
2. 校验 URL 协议 ∈ {http, https}
3. extensionName = sanitize(path.basename(parsedUrl.pathname, '.git'))
   —— 注意：扩展文件夹名取自 URL 末段，去掉 .git 后缀
4. basePath = global ? PUBLIC_DIRECTORIES.globalExtensions
                : request.user.directories.extensions
5. 若 basePath/<name> 已存在 → 409 Conflict（不会覆盖已有安装）
6. cloneOptions = { depth: 1 }
   若传了 branch → cloneOptions.branch = branch
7. git.clone(url, extensionPath, cloneOptions)
   —— 无 branch 时克隆【默认分支】
8. 读取并校验 manifest.json：
   - 必须是 JSON 对象（非数组）
   - 解析失败 / 不合法 → rm -rf 整个目录并抛错
9. 返回 { version, author, display_name, extensionPath, folderName }
```

### 2.3 关键推论（直接影响打包/发布策略）

- **克隆深度固定 `--depth 1`**：本地仓库没有完整历史，但**默认分支 HEAD 上有什么就被装什么**。
- **默认分支决定一切**：用户在 ST 里粘贴裸 URL 时，ST 拉的是仓库 GitHub 默认分支。要让"贴 URL 即可用"成立，默认分支的根目录必须同时存在 `manifest.json` 和它引用的 `dist/*` 文件。
- **不允许覆盖安装**：同名扩展已存在会直接 409。改版本必须先 delete 或换文件夹名。
- **分支选择走的是 `git clone --branch`**，而不是 checkout；这是 ST UI 上"切换分支"功能的底层。

---

## 3. 加载（Load / Activate）

加载完全发生在**客户端**，每次 ST 启动（或安装/卸载/切换分支后）通过 `loadExtensionSettings(...)` 触发（L1783）。流程：

```text
1. discoverExtensions()  →  GET /api/extensions/discover
                            返回 [{ type, name }, ...]
2. extensionNames = extensions.map(x => x.name)
   extensionTypes = { [name]: type }
3. getManifests(names)   →  对每个 name 并行
                            fetch /scripts/extensions/<name>/manifest.json
                            失败的扩展被跳过（仅 console.log）
4. （可选）autoUpdateExtensions：版本变更时按需 git pull
5. activateExtensions()  →  见下
```

### 3.1 `activateExtensions()` 的逐项检查（L568）

对每个扩展，按 `loading_order`（升序）+ `display_name`（字典序）排序后逐个判定：

| 检查 | 字段 | 不满足时的行为 |
|------|------|---------------|
| 已激活？ | — | 跳过 |
| 客户端版本 | `minimum_client_version` | 记录 `extensionLoadErrors`，不加载 |
| Extras 模块 | `requires: string[]` | 同上，提示缺哪些模块 |
| 依赖扩展 | `dependencies: string[]` | 同上；若依赖存在但被禁用，单独提示 |
| 被禁用？ | `extension_settings.disabledExtensions` | 静默跳过 |

注意几个**易踩的坑**：

- `requires` 是 **Extras API 模块**（如 `embeddings`），不是 ST 内置能力。只有连接到 Extras 才会校验。
- `dependencies` 检查的是**已发现的扩展名**是否齐全，且没被禁用。
- 这三项字段如果**不是数组**会放行加载，只打 `console.warn`，所以写错了不会让扩展爆炸——但也不会真的起到约束作用。

### 3.2 通过后的注入

通过检查后，依次：

1. `addExtensionLocale(name, manifest)` —— 读 `manifest.i18n[currentLocale]`，若有则 `fetch` 并 `addLocaleData`。
2. **并行**：
   - `addExtensionScript`：当 `manifest.js` 存在时，创建 `<script type="module" async src="/scripts/extensions/<name>/<manifest.js>">` 插入 `document.body`。**只支持 ES module**，不支持经典脚本。
   - `addExtensionStyle`：当 `manifest.css` 存在时，创建 `<link rel="stylesheet" href="...">` 插入 `document.head`。
3. 都成功后 `activeExtensions.add(name)`，再调用 `activate` 钩子。
4. 任一步抛错（含 404 / 网络错 / 模块执行错）→ 该扩展标记为加载失败，记录到 `extensionLoadErrors`，UI 上的 `#extensions_details` 会显示警告样式。

> 重复注入有幂等保护：通过元素的 id（`<name>-js` / `<name>-css`）查重，已存在则跳过。

### 3.3 关于 `manifest.html`

**SillyTavern 自身不会读取或注入 `manifest.html`**。客户端 `extensions.js` 全程没有 `manifest.html` 这个字段的使用点；只有 `renderExtensionTemplate(Async)` 这种按需读 HTML 模板的工具函数，且需要扩展代码主动调用。

第三方扩展的 UI 一律通过自己的 JS 入口在运行时挂载（Engram 就是 React `createRoot(...).render(...)` 挂到 `#root`）。manifest 里写 `"html": "dist/index.html"` 只是元数据，**ST 不会打开它**。

---

## 4. 升级、卸载、分支管理

| 操作 | 客户端函数 | 服务端路由 | 服务端动作 |
|------|-----------|-----------|-----------|
| 检查更新 | `checkForExtensionUpdates` | `POST /api/extensions/version` | `git fetch` + 比对 `HEAD` 与 `origin/<branch>` |
| 拉取更新 | `updateExtension` | `POST /api/extensions/update` | `git pull origin <currentBranch>`，返回 `shortCommitHash` |
| 自动更新 | `autoUpdateExtensions` | 同 update | 启动时（若 `extension_settings.notifyUpdates`）批量拉 |
| 列出分支 | `switchExtensionBranch`（取列表） | `POST /api/extensions/branches` | `git remote set-branches origin *` + `fetch` + 列本地+远程分支 |
| 切换分支 | `switchExtensionBranch` | `POST /api/extensions/switch_branch` | 已有本地分支 → `checkout`；远程分支 → `checkout -b` |
| 删除 | `deleteExtension` | `POST /api/extensions/delete` | `fs.rm(extensionPath, { recursive: true })` |
| 移动（local↔global） | `moveExtension` | `POST /api/extensions/copy` | `fs.cp` 拷贝到目标目录（不会删除源） |

几个值得记住的点：

- **更新走 `git pull`，不重新 clone**。如果默认分支被换了历史（如 force-push、rebase），浅克隆可能 pull 失败，需要用户手动删除后重装。
- **`global` 操作全部要求 admin**：安装/更新/删除/切分支皆是。
- **`delete` 是物理 `rm -rf`**——没有"软删除"。删除前会先调用扩展的 `delete` 钩子（如果有）。
- **`/copy` 是拷贝不是移动**，源目录保留；客户端的 `moveExtension` 会在拷贝成功后再调用 delete。

---

## 5. 生命周期钩子（manifest `hooks`）

manifest 里可选地声明 `hooks`：

```json
{
    "hooks": {
        "install": "onInstall",
        "update": "onUpdate",
        "delete": "onDelete",
        "clean": "onClean",
        "enable": "onEnable",
        "disable": "onDisable",
        "activate": "onActivate"
    }
}
```

调用方：`callExtensionHook(name, hookName)`（`extensions.js` L406）。

机制：

1. 读 manifest，没有 `hooks` 对象 / 没有该 key → 直接返回。
2. 必须 `manifest.js` 也存在——否则 warn 并跳过。
3. `import(/scripts/extensions/<name>/<manifest.js>)` 动态导入模块。
4. 取导出的同名函数；不是函数则 warn 跳过。
5. 调用之；若返回 Promise 则 await，**整体超过 5000ms 视为超时**（不阻断流程，仅 warn）。

钩子触发时机：

| 钩子 | 触发点 |
|------|-------|
| `install` | `installExtension` 末尾 |
| `update` | `updateExtension` 成功 pull 之后 |
| `delete` | `deleteExtension` 真正 `rm` 之前 |
| `clean` | `cleanExtension`（用户主动"清理数据"时）；也在 `deleteExtension(shouldClean=true)` 流程里 |
| `enable` | `enableExtension`（在更新 disabled 列表之前） |
| `disable` | `disableExtension`（在更新 disabled 列表之前） |
| `activate` | `activateExtensions` 注入 script+css 成功之后 |

注意 `enable/disable` 触发后通常会 `location.reload()`——钩子在重载前同步执行；而 `activate` 是每次页面加载都跑一次。

---

## 6. manifest.json 字段速查

基于上述源码反推（ST 没有 schema 文件，所有字段都是"读不到就跳过"的软约束）：

| 字段 | 类型 | 必需 | 作用 |
|------|------|------|------|
| `display_name` | string | 推荐 | UI 显示名；也用于排序兜底 |
| `version` | string | 推荐 | UI 显示；不参与版本判定 |
| `author` | string | 可选 | UI 显示 |
| `loading_order` | number | 可选 | 越小越先加载；同值按 `display_name` 字典序 |
| `js` | string | **核心** | 相对扩展根的 JS 入口；必须以 ES module 形式可被加载 |
| `css` | string | 可选 | 相对扩展根的样式表 |
| `html` | string | 可选 | **不会被 ST 自动加载**，纯元数据 |
| `requires` | string[] | 可选 | 所需的 Extras 模块名；非数组时跳过校验 |
| `optional` | string[] | 可选 | 可选 Extras 模块；仅 UI 提示用 |
| `dependencies` | string[] | 可选 | 依赖的其他扩展内部名；缺失或被禁用则不加载 |
| `minimum_client_version` | string | 可选 | 形如 `1.12.0`；低于则不加载 |
| `i18n` | `{ [locale]: filepath }` | 可选 | 当前 locale 命中时按路径加载 JSON 并注册 |
| `hooks` | `{ [name]: string }` | 可选 | 见 §5 |
| `homePage` | string | 可选 | UI 上"主页"链接 |

> 字段缺失 / 类型不对都不会让 ST 崩溃，只会让对应行为静默跳过——这是 ST 的一贯风格，调试时不要被"没报错但没生效"迷惑。

---

## 7. 排错速查

**装上了但 UI 不出现 / 脚本没跑：**

1. 浏览器 DevTools → Network 看 `/scripts/extensions/third-party/<name>/manifest.js` 是不是 200。404 多半是 manifest 里 `js` 路径写错或文件没打进去。
2. Console 找 `Could not activate extension` / `Extension "<name>" did not load`。
3. 看 `extensionLoadErrors`：在 Console 跑 `document.querySelector('#extensions_details')` 是否带 `warning` class。
4. 检查 `requires` / `dependencies` / `minimum_client_version` 是否误写成了非数组/非字符串。

**Install 报 409：** 同名目录已存在。先在扩展面板里 delete，或手动去 `data/.../extensions/third-party/` 删掉。

**Install 报 "Could not determine the extension name"：** URL pathname 末段解析失败（比如以 `/` 结尾又没有 `.git`）。换一个标准 https GitHub URL。

**更新不生效：** 浅克隆 + `git pull`。如果上游做过 force-push / 改默认分支，pull 可能失败，需要删除重装。可在 ST 扩展面板用"切换分支"功能切到正确分支。

**`html` 字段写了却不显示：** 正常。ST 不会自动加载 `manifest.html`，扩展必须自己在 JS 里挂 UI。

---

## 8. 对 Engram 的实际约束（备忘）

1. `manifest.json` 引用的 `dist/index.js`、`dist/style.css` 必须存在于"ST 拉到的目录"的根。
2. `dist/index.js` 必须是合法的 ES module（Vite 默认就是）。
3. 想让"贴裸 URL 即可装"成立 → GitHub 仓库默认分支的根必须有 `manifest.json + dist/`。这正是我们用 `release` 分支做发布分支的原因（见仓库根 `.github/workflows/release.yml`）。
4. 升级是 `git pull`，所以 `release` 分支尽量只 fast-forward；避免 force-push 让用户的浅克隆 pull 失败。
