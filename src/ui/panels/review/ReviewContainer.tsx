import type {
    ReviewAction,
    ReviewRequest,
} from "@/domain/review/ReviewBridge.ts";
import { useReviewStore } from "@/state/reviewStore.ts";
import { ModernButton as Button } from "@/ui/components/core/Button.tsx";
import {
    AlertTriangle,
    ArrowDownToLine,
    Check,
    Layers,
    Minus,
    RefreshCw,
    RotateCcw,
    X,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { EntityReview } from "./EntityReview.tsx";
import { MessageReview } from "./MessageReview.tsx";
import { RecallDecisionModal } from "./RecallDecisionModal.tsx";
import { SummaryReview } from "./SummaryReview.tsx"; // V1.2

// --- Sub-component: ReviewSession ---
// Encapsulates state and logic for a SINGLE review request
interface ReviewSessionProps {
    request: ReviewRequest;
    isActive: boolean;
    onFinish: (requestId: string) => void;
    footerEl: HTMLElement | null; // V1.5: Portal target for footer
}

const ReviewSession: React.FC<ReviewSessionProps> = (
    { request, isActive, onFinish, footerEl },
) => {
    // Independent state for this session
    const [content, setContent] = useState(request.content);
    const [data, setData] = useState<any>(request.data);
    const [query, setQuery] = useState<string | undefined>(request.data?.query);

    // Phase 2 Fix: 监听 request 的变化以同步状态（防御闭包读取到早期缓存）
    useEffect(() => {
        setContent(request.content);
        setData(request.data);
        setQuery(request.data?.query);
    }, [request.content, request.data, request.data?.query]);

    // Reject Feedback State
    const [feedback, setFeedback] = useState("");
    const [showFeedbackInput, setShowFeedbackInput] = useState(false);
    const [_isProcessing, setIsProcessing] = useState(false);
    const [isRecallModalOpen, setIsRecallModalOpen] = useState(false);

    const handleAction = (action: ReviewAction) => {
        if (action === "reject" && !showFeedbackInput) {
            setShowFeedbackInput(true);
            return;
        }

        setIsProcessing(true);

        const resultData = query !== undefined ? { ...data, query } : data;
        request.onResult({
            action,
            content,
            data: resultData,
            feedback: action === "reject" ? feedback : undefined,
        });

        // Notify parent to remove this session
        onFinish(request.id);
    };

    // Keep mounted but hidden if not active to preserve state
    const displayStyle = isActive ? { display: "flex" } : { display: "none" };

    return (
        <div
            className="flex flex-col flex-1 min-h-0 w-full"
            style={displayStyle}
        >
            {/* Header (Session Info) - Optional, can be merged into Tab bar or kept here */}
            {request.description && (
                <div className="px-5 py-2 border-b border-border bg-muted/20 text-xs text-muted-foreground flex items-center justify-between">
                    <span>{request.description}</span>
                    <span className="uppercase border border-border px-1 rounded bg-background">
                        {request.type}
                    </span>
                </div>
            )}

            {/* Content Area */}
            <div className="flex-1 min-h-0 p-5 overflow-y-auto bg-background/50 custom-scrollbar">
                {showFeedbackInput
                    ? (
                        <div className="flex flex-col h-full gap-4">
                            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md flex items-center gap-3">
                                <AlertTriangle className="text-destructive shrink-0" />
                                <div>
                                    <h4 className="font-medium text-destructive">
                                        准备打回重写
                                    </h4>
                                    <p className="text-xs text-destructive/80">
                                        请输入修改意见，AI
                                        将根据您的反馈重新生成。
                                    </p>
                                </div>
                            </div>
                            <textarea
                                value={feedback}
                                onChange={(e) => setFeedback(e.target.value)}
                                className="flex-1 w-full min-h-[150px] p-4 bg-muted border border-border rounded-md focus:ring-2 focus:ring-destructive resize-none"
                                placeholder="例如：请不要引入新人物..."
                                autoFocus
                            />
                        </div>
                    )
                    : (
                        request.type === "entity"
                            ? (
                                <EntityReview
                                    data={data ||
                                        {
                                            newEntities: [],
                                            updatedEntities: [],
                                        }}
                                    onChange={(newData) => setData(newData)}
                                />
                            )
                            : request.type === "summary"
                            ? (
                                <SummaryReview
                                    content={content}
                                    data={data}
                                    onChange={(newContent, newData) => {
                                        setContent(newContent);
                                        setData(newData);
                                    }}
                                />
                            )
                            : (
                                <MessageReview
                                    content={content}
                                    onChange={(newContent) =>
                                        setContent(newContent)}
                                    query={query}
                                    onQueryChange={query !== undefined
                                        ? setQuery
                                        : undefined}
                                    agenticRecalls={data?.agenticRecalls}
                                    onAgenticRecallsChange={(newRecalls) =>
                                        setData({
                                            ...data,
                                            agenticRecalls: newRecalls,
                                        })}
                                    onOpenRecallModal={() =>
                                        setIsRecallModalOpen(true)}
                                />
                            )
                    )}
            </div>

            {/* Footer / Action Bar (Portaled to Window Level) */}
            {footerEl && isActive && ReactDOM.createPortal(
                <div className="flex flex-col-reverse sm:flex-row items-center justify-between px-4 py-4 sm:px-5 gap-4 sm:gap-0 h-full w-full">
                    <div className="flex gap-2 w-full sm:w-auto">
                        {showFeedbackInput
                            ? (
                                <Button
                                    label="返回"
                                    onClick={() => setShowFeedbackInput(false)}
                                    className="w-full sm:w-auto"
                                />
                            )
                            : (
                                request.actions?.includes("fill") && (
                                    <Button
                                        label="填充"
                                        icon={ArrowDownToLine}
                                        onClick={() => handleAction("fill")}
                                        className="text-muted-foreground hover:text-foreground w-full sm:w-auto"
                                    />
                                )
                            )}
                    </div>
                    <div className="flex gap-3 w-full sm:w-auto">
                        {showFeedbackInput
                            ? (
                                <Button
                                    label="提交打回"
                                    icon={RotateCcw}
                                    onClick={() => handleAction("reject")}
                                    disabled={!feedback.trim()}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90 w-full sm:w-auto"
                                />
                            )
                            : (
                                <>
                                    {request.actions?.includes("reject") &&
                                        <Button
                                            label="打回"
                                            icon={RotateCcw}
                                            onClick={() =>
                                                handleAction("reject")}
                                            className="text-destructive hover:bg-destructive/10 border-destructive/30 flex-1 sm:flex-none"
                                        />}
                                    {request.actions?.includes("reroll") &&
                                        <Button
                                            label="重抽"
                                            icon={RefreshCw}
                                            onClick={() =>
                                                handleAction("reroll")}
                                            className="flex-1 sm:flex-none"
                                        />}
                                    {request.actions?.includes("confirm") &&
                                        <Button
                                            label="确认"
                                            icon={Check}
                                            primary
                                            onClick={() =>
                                                handleAction("confirm")}
                                            className="min-w-[100px] flex-1 sm:flex-none"
                                        />}
                                </>
                            )}
                    </div>
                </div>,
                footerEl,
            )}

            {/* Agentic RAG 决策编辑弹窗 (V1.4) */}
            {data?.agenticRecalls && (
                <RecallDecisionModal
                    isOpen={isRecallModalOpen}
                    onClose={() => setIsRecallModalOpen(false)}
                    initialRecalls={data.agenticRecalls}
                    onConfirm={(newRecalls) => {
                        setData({ ...data, agenticRecalls: newRecalls });
                        setIsRecallModalOpen(false);
                    }}
                />
            )}
        </div>
    );
};

// --- Main Container ---
export const ReviewContainer: React.FC = () => {
    const requests = useReviewStore((s) => s.requests);
    const removeRequest = useReviewStore((s) => s.remove);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [isMinimized, setIsMinimized] = useState(false);
    const [footerEl, setFooterEl] = useState<HTMLElement | null>(null); // State to hold ref to footer slot
    const prevReqCount = useRef(0);

    // 新请求到达时：若无激活项则激活首条，并展开面板
    useEffect(() => {
        if (requests.length > prevReqCount.current) {
            setActiveId((current) => current ?? requests[0].id);
            setIsMinimized(false);
        }
        prevReqCount.current = requests.length;
    }, [requests]);

    const handleSessionFinish = (finishedId: string) => {
        removeRequest(finishedId);
        // If we removed the active one, switch to another if available
        if (activeId === finishedId) {
            const next = requests.filter((r) => r.id !== finishedId);
            setActiveId(next.length > 0 ? next[0].id : null);
        }
    };

    const handleRestore = () => setIsMinimized(false);

    // Render Logic
    if (requests.length === 0) return null;

    // Minimized Badge
    if (isMinimized) {
        return ReactDOM.createPortal(
            <div className="engram-app-root" style={{ display: "contents" }}>
                <div className="fixed bottom-4 right-4 z-[9999] pointer-events-auto">
                    <button
                        onClick={handleRestore}
                        className="flex items-center gap-2 px-4 py-3 bg-primary text-primary-foreground shadow-lg rounded-full hover:scale-105 transition-transform font-medium border-2 border-primary-foreground/20"
                    >
                        <Layers size={18} />
                        <span>待处理 ({requests.length})</span>
                    </button>
                </div>
            </div>,
            document.body,
        );
    }

    return ReactDOM.createPortal(
        <div className="engram-app-root" style={{ display: "contents" }}>
            <div
                className="fixed inset-0 z-[11000] flex items-center justify-center p-4 sm:p-4 pointer-events-auto"
                style={{ height: "100dvh", width: "100vw" }} // Explicitly force full viewport info
            >
                <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />

                <div className="relative w-full max-w-4xl bg-popover border border-border rounded-lg shadow-2xl flex flex-col h-[90dvh] sm:h-auto sm:max-h-[90vh] min-h-0 sm:min-h-[500px] border-t-4 border-t-primary">
                    {/* Top Bar: Tabs & Window Controls */}
                    <div className="flex items-center justify-between px-2 pt-2 border-b border-border bg-muted/40">
                        {/* Tabs Scroll Area */}
                        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 pr-4">
                            {requests.map((req) => {
                                const isActive = req.id === activeId;
                                return (
                                    <button
                                        key={req.id}
                                        onClick={() => setActiveId(req.id)}
                                        className={`
                                            flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-md transition-colors border-t border-x mb-[-1px]
                                            ${
                                            isActive
                                                ? "bg-popover border-border text-foreground border-b-transparent z-10"
                                                : "bg-muted/50 border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/80"
                                        }
                                        `}
                                    >
                                        <span className="truncate max-w-[120px]">
                                            {req.title}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Window Controls */}
                        <div className="flex items-center gap-1 mb-1 px-2">
                            <button
                                onClick={() => setIsMinimized(true)}
                                className="p-1.5 text-muted-foreground hover:text-foreground rounded-md transition-colors"
                                title="最小化"
                            >
                                <Minus size={16} />
                            </button>
                            <button
                                onClick={() => {
                                    if (activeId) {
                                        // Cancel active request
                                        const req = requests.find((r) =>
                                            r.id === activeId
                                        );
                                        if (req) {
                                            req.onResult({
                                                action: "cancel",
                                                content: "",
                                                data: req.data,
                                            });
                                            handleSessionFinish(activeId);
                                        }
                                    }
                                }}
                                className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                                title="关闭/取消当前"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Sessions Area */}
                    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
                        {requests.map((req) => (
                            <ReviewSession
                                key={req.id}
                                request={req}
                                isActive={req.id === activeId}
                                onFinish={handleSessionFinish}
                                footerEl={footerEl}
                            />
                        ))}
                        {/* Empty State (Shouldn't happen if logic is correct) */}
                        {requests.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                <Check size={48} className="mb-2 opacity-20" />
                                <p>所有任务已完成</p>
                            </div>
                        )}
                    </div>

                    {/* Footer Slot (Window Level) */}
                    <div
                        ref={setFooterEl}
                        className="flex-none border-t border-border bg-muted/30 min-h-[60px]"
                    >
                        {/* Portaled Content will appear here */}
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
};
