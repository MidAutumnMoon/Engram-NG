/**
 * PanelErrorBoundary - 隔离 PanelRoot 渲染错误
 *
 * 设计意图：复刻旧双根架构下的错误隔离。以前 PanelRoot 是独立的 createRoot，
 * 抛错只会卸载面板根，QuickPanel / ReviewContainer 仍存活。现在三者共用一个根，
 * 没有 boundary 的话 PanelRoot 抛错会把整个 EngramRoot 卸掉。
 *
 * 行为：捕获错误后渲染 null（面板看起来是关上的），不影响 EngramRoot 的其它子树。
 * 当 panelOpen 翻回 false 时重置错误状态，下次开面板会重新尝试挂载 PanelRoot。
 */
import React from "react";

interface Props {
    /** 当外部判定面板应关闭（panelOpen=false）时改变，触发错误状态重置。 */
    resetKey: boolean;
    children: React.ReactNode;
}

interface State {
    hasError: boolean;
}

export class PanelErrorBoundary extends React.Component<Props, State> {
    override state: State = { hasError: false };

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    override componentDidUpdate(prevProps: Props): void {
        // resetKey 翻为 false 时清空错误状态——下次开面板可重新尝试挂载。
        if (prevProps.resetKey && !this.props.resetKey && this.state.hasError) {
            this.setState({ hasError: false });
        }
    }

    override componentDidCatch(error: Error, info: React.ErrorInfo): void {
        console.error("[Engram] PanelRoot 渲染失败，已隔离:", error, info);
    }

    override render(): React.ReactNode {
        if (this.state.hasError) {
            return null;
        }
        return this.props.children;
    }
}
