import { useEffect } from "react";

export const GlobalStyles = () => {
    useEffect(() => {
        // Phase 3 Fix: 清理函数，防止重复挂载或热重载时无限累积
        return () => {
            const preload = document.querySelector("#engram-font-preload");
            if (preload) preload.remove();
            // 这里不对 href 为 https://fonts.googleapis.com 的 link 做直接移除，
            // 因为它们一般只加载一次全局复用，频繁增删反倒影响宿主的字体解析，
            // 此处主要为了防止同 ID 重复冗余。
        };
    }, []);

    return (
        <style>
            {`
    :root {
      --font-sans: sans-serif;
      --font-mono: monospace;
    }

    .engram-app-root {
      font-family: var(--font-sans);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .font-mono {
      font-family: var(--font-mono);
    }

    /* Custom Scrollbar for dark theme - Minimalist */
    .engram-app-root ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    .engram-app-root ::-webkit-scrollbar-track {
      background: transparent;
    }
    .engram-app-root ::-webkit-scrollbar-thumb {
      background: rgba(63, 63, 70, 0.4); /* zinc-700 with opacity */
      border-radius: 3px;
    }
    .engram-app-root ::-webkit-scrollbar-thumb:hover {
      background: rgba(82, 82, 91, 0.6); /* zinc-600 with opacity */
    }

    /* Utility to hide scrollbar but keep functionality */
    .no-scrollbar::-webkit-scrollbar {
      display: none;
    }
    .no-scrollbar {
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
  `}
        </style>
    );
};
