import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import deno from "@deno/vite-plugin";

export default defineConfig(({ mode }) => ({
    plugins: [
        react(),
        deno(),
    ],

    // Gotcha:
    // Lib 模式下 Vite 不会自动将 process.env.NODE_ENV 替换为 "production"（它假定
    // 消费方会做这一步）。但我们直接发到浏览器、由 SillyTavern 加载，没有下游构建。
    // 不定义则 React CJS 入口会走进 .development.js 分支，bundle 体积翻倍。
    define: {
        "process.env.NODE_ENV": JSON.stringify(mode),
    },

    publicDir: "public",

    build: {
        outDir: "dist",
        emptyDirOnBuild: true,

        // Because of `codeSplitting: false` we increase the warning threshold.
        chunkSizeWarningLimit: 1500,

        // Lib 模式：扩展由 SillyTavern 以 <script type="module"> 加载 dist/index.js，
        // 不需要 index.html。此前一度改用 App 模式是为绕开 Tailwind v4.0 的
        // lib 模式不输出 CSS 的 bug；该问题在 v4.2 已修复，当前锁定 v4.3+。
        lib: {
            entry: "src/bootstrap.ts",
            formats: ["es"],
            fileName: "index",
        },

        rollupOptions: {
            output: {
                codeSplitting: false,
                // Lib 模式默认按 format 添加扩展名（es→.mjs），但 SillyTavern 按
                // manifest.json 固定加载 dist/index.js，必须强制为 .js。
                entryFileNames: "index.js",
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name?.endsWith(".css")) {
                        return "style.css";
                    }
                    return "assets/[name][extname]";
                },
                minify: { mangle: false, compress: true },
            },
        },

        minify: "oxc",
        sourcemap: true,
    },

    resolve: {
        alias: {
            "@": new URL("./src", import.meta.url).pathname,
        },
    },
}));
