import { useEffect, useState } from "react";

const DESKTOP_BREAKPOINT = 768;

/**
 * useResponsive Hook
 *
 * 返回当前视口是否为移动端（< 768px）。监听 resize，150ms 防抖。
 */
export function useResponsive(): boolean {
    const [isMobile, setIsMobile] = useState(
        () => window.innerWidth < DESKTOP_BREAKPOINT,
    );

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth < DESKTOP_BREAKPOINT);
        };

        // 防抖，避免高频 resize 触发不必要的重绘
        let debounceTimer: ReturnType<typeof setTimeout>;
        const debouncedResize = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(handleResize, 150);
        };

        window.addEventListener("resize", debouncedResize);

        // 初始检测（立即执行，不走防抖）
        handleResize();

        return () => {
            window.removeEventListener("resize", debouncedResize);
            clearTimeout(debounceTimer);
        };
    }, []);

    return isMobile;
}
