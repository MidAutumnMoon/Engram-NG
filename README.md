<div align="center">
  <img src="public/logo/Engram_logo.svg" alt="Engram Logo" width="250" />

# Engram

> **Graph RAG Memory Operation System** - _Where memories leave their trace._

![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)

</div>

**Engram** 是专为 **SillyTavern (酒馆)** 设计的下一代智能记忆扩展。它通过**RAG
(检索增强生成)** 技术，不仅提供直观的记忆可视化，更能让 AI
角色拥有持久、连贯且可追溯的记忆能力。

---

## 🛠️ 技术栈 (Tech Stack)

![React](https://img.shields.io/badge/React-20232a?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Zustand](https://img.shields.io/badge/Zustand-bear?style=for-the-badge&color=orange)
![Dexie](https://img.shields.io/badge/Dexie.js-323330?style=for-the-badge&logo=indexeddb&logoColor=white)

---

## ✨ 核心特性 (Features)

- **Memory Stream (记忆流)**: 以时间轴形式直观展示所有记忆片段，支持重要度高亮。
- **Story Summary (剧情总结)**:
  内置纯文本双层记忆总结系统，自动提炼关键剧情，防止上下文遗忘。
- **API Presets (API 预设)**: 灵活配置多种 LLM
  接口，支持针对不同任务（总结、提取）使用不同模型。
- **Modern UI (现代化界面)**: 采用 Glassmorphism
  设计语言，配合流畅动画，提供原生应用级体验。
- **Dev Log (开发日志)**: 内置实时日志查看器，方便调试与监控。

---

## 📦 安装 (Installation)

### 分支模型

仓库分为两个分支：

- **`release`（默认分支）**：由 CI 自动构建，仅包含 ST 安装所需的产物
  (`manifest.json` + `dist/`)。SillyTavern 用裸 URL 安装时克隆的就是它。
- **`master`（源码分支）**：开发、议题、PR 的去处。**不含 `dist/`**， 保持搜索与
  agent 上下文干净。

### 方式一：扩展管理 (推荐)

直接在 **SillyTavern** 的扩展管理界面安装：

1. 打开扩展管理 (Extensions) -> **安装扩展 (Install Extension)**。
2. 在 URL 栏输入本仓库地址：
   ```
   https://github.com/shiyue137mh-netizen/Engram
   ```
3. 点击 **获取 (Get)** 或 **安装 (Install)**。
4. 安装完成后，刷新酒馆页面即可。

> ST 会克隆默认分支 `release`，里面已经是预构建产物，无需手动构建。

### 方式二：Git 克隆 (开发者)

```bash
cd SillyTavern/public/scripts/extensions/third-party/
# 想直接使用：克隆默认分支 release
# 想参与开发：加 -b master 拿到源码
# 克隆源码后需运行 deno task build 才会生成 dist/
git clone -b master https://github.com/shiyue137mh-netizen/Engram.git
cd Engram
```

---

## 💻 开发指南 (Development)

如果您想参与开发或自行构建：

本项目使用 [Deno](https://deno.com/) 作为运行时与任务管理器，无需
`npm install`。开发前请先安装 Deno。

```bash
# 启动 HMR 开发模式 (推荐)
# 支持热更新，修改代码后无需刷新浏览器
deno task dev

# 生产环境构建
deno task build

# 传统监听模式
deno task dev:watch
```

> 说明：依赖通过 `deno.jsonc` 的 `imports` 字段声明，由 Deno
> 自动拉取并缓存，无需手动安装。

---

## 📁 目录结构 (Project Structure)

参考"docs/architecture/项目文件架构.md"

---

## 📄 开源协议 (License)

MIT License
