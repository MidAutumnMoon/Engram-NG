import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";

interface Props {
    children?: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public override state: State = {
        error: null,
        hasError: false,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { error, hasError: true };
    }

    public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        // console, not Logger: this is render-phase, the component tree (and
        // possibly Logger's own dependencies) may be in a broken state.
        console.error("[ErrorBoundary] Uncaught error:", error, errorInfo);
        if (this.props.onError) {
            this.props.onError(error, errorInfo);
        }
    }

    public override render() {
        if (this.state.hasError) {
            return this.props.fallback || (
                <div className="p-4 m-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center justify-center">
                    <span>组件加载失败，请检查数据完整性或尝试刷新。</span>
                </div>
            );
        }

        return this.props.children;
    }
}
