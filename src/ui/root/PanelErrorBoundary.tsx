/**
 * PanelErrorBoundary - 隔离 PanelRoot 渲染错误
 *
 * PanelRoot 与 ReviewContainer / QuickPanel 共用一个 React 根。如果没有 boundary，
 * PanelRoot 内部任一视图抛错会卸载整根 EngramRoot，连带丢掉 ReviewContainer 的
 * EventBus 订阅。本 boundary 捕获这类错误后渲染 null（面板表现为关上），让其它子树存活。
 *
 * 当 panelOpen 从 true 翻回 false 时重置错误状态，下次开面板会重新尝试挂载。
 */
import React from "react";

interface Props {
    /** 当前 panelOpen 值。true→false 的下降沿触发错误状态重置。 */
    panelOpen: boolean;
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
        // 关闭面板时清空错误状态，下次开面板可重新尝试挂载。
        const closed = prevProps.panelOpen && !this.props.panelOpen;
        if (closed && this.state.hasError) {
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
