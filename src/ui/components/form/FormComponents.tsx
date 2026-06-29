import { Switch } from "./Switch.tsx";
import { ChevronDown, Search, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

/**
 * 表单原语 — 容器式（contained）布局。
 *
 * 设计原则：
 * - 标签在控件**上方**，控件是一个有柔和边框/底色的「盒子」，
 *   解决旧版「标签左 / 控件右 + 无框」导致难以扫读、光标需长途移动的问题。
 * - 描述文字在盒子下方，与标签分离，避免视觉拥挤。
 * - 所有原语共用同一套盒子样式（fieldBox），保证一致观感。
 * - 仍然偏「无框流体」：盒子底色极淡（muted/20），边框极淡（border/50），
 *   聚焦时边框转 primary 提示焦点。不喧宾夺主。
 */

// 共享的「盒子」样式
const fieldBox =
    "w-full bg-muted/20 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary focus:bg-muted/30 disabled:opacity-50 disabled:cursor-not-allowed";

interface FormSectionProps {
    title: string | React.ReactNode;
    description?: string | React.ReactNode;
    children: React.ReactNode;
    className?: string;
    collapsible?: boolean;
    defaultCollapsed?: boolean;
}

export const FormSection: React.FC<FormSectionProps> = ({
    title,
    description,
    children,
    className = "",
    collapsible = false,
    defaultCollapsed = false,
}) => {
    const [isCollapsed, setIsCollapsed] = useState(
        collapsible ? defaultCollapsed : false,
    );

    return (
        <section className={`mb-7 ${className}`}>
            <div
                className={`mb-3 ${
                    collapsible
                        ? "cursor-pointer select-none flex items-center justify-between group"
                        : ""
                }`}
                onClick={() => collapsible && setIsCollapsed(!isCollapsed)}
            >
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-heading flex items-center gap-2">
                        {title}
                    </h3>
                    {description &&
                        <p className="text-xs text-muted-foreground mt-1 break-words">
                            {description}
                        </p>}
                </div>
                {collapsible && (
                    <ChevronDown
                        size={16}
                        className={`text-muted-foreground shrink-0 ${
                            isCollapsed ? "-rotate-90" : "rotate-0"
                        }`}
                    />
                )}
            </div>
            <div
                className={`space-y-4 ${isCollapsed ? "hidden" : "block"}`}
            >
                {children}
            </div>
        </section>
    );
};

interface BaseFieldProps {
    label: string | React.ReactNode;
    description?: string | React.ReactNode;
    error?: string;
    required?: boolean;
    className?: string;
}

interface TextFieldProps extends BaseFieldProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    type?: "text" | "password" | "email" | "url" | "number";
    disabled?: boolean;
    readOnly?: boolean;
    multiline?: boolean;
    rows?: number;
}

export const TextField: React.FC<TextFieldProps> = ({
    label,
    description,
    error,
    required,
    className = "",
    value,
    onChange,
    placeholder,
    type = "text",
    disabled,
    readOnly,
    multiline,
    rows = 3,
}) => {
    // 用结构化类型而非 <input> 专属类型，使 common 同时满足 <input> 与 <textarea>。
    const common: {
        value: string;
        onChange: (e: { target: { value: string } }) => void;
        placeholder?: string;
        disabled?: boolean;
        readOnly?: boolean;
    } = {
        value,
        onChange: (e) => onChange(e.target.value),
        placeholder,
        disabled,
        readOnly,
    };
    return (
        <FieldShell
            label={label}
            description={description}
            error={error}
            required={required}
            className={className}
        >
            {multiline
                ? (
                    <textarea
                        {...common}
                        rows={rows}
                        className={`${fieldBox} font-mono resize-y min-h-[80px]`}
                    />
                )
                : (
                    <input
                        type={type}
                        {...common}
                        className={fieldBox}
                    />
                )}
        </FieldShell>
    );
};

interface NumberFieldProps extends BaseFieldProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
    disabled?: boolean;
}

export const NumberField: React.FC<NumberFieldProps> = ({
    label,
    description,
    error,
    required,
    className = "",
    value,
    onChange,
    min,
    max,
    step = 1,
    suffix,
    disabled,
}) => (
    <FieldShell
        label={label}
        description={description}
        error={error}
        required={required}
        className={`${className} ${
            disabled ? "opacity-50 pointer-events-none" : ""
        }`}
    >
        <div className={`flex items-center gap-2 ${fieldBox} !py-1.5`}>
            <input
                type="number"
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={disabled}
                onChange={(e) => onChange(Number(e.target.value))}
                className="flex-1 bg-transparent border-0 outline-none text-sm text-foreground [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:cursor-not-allowed"
            />
            {suffix &&
                <span className="text-xs font-medium text-muted-foreground shrink-0">
                    {suffix}
                </span>}
        </div>
    </FieldShell>
);

interface SelectOption {
    value: string;
    label: string;
}

interface SelectFieldProps extends BaseFieldProps {
    value: string;
    onChange: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
}

export const SelectField: React.FC<SelectFieldProps> = ({
    label,
    description,
    error,
    required,
    className = "",
    value,
    onChange,
    options,
    placeholder = "请选择...",
    disabled,
}) => (
    <FieldShell
        label={label}
        description={description}
        error={error}
        required={required}
        className={className}
    >
        <div className="relative">
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                style={{
                    WebkitAppearance: "none" as const,
                    appearance: "none" as const,
                }}
                className={`${fieldBox} !pr-9 cursor-pointer`}
            >
                <option
                    value=""
                    disabled
                    className="bg-popover text-muted-foreground"
                >
                    {placeholder}
                </option>
                {options.map((opt) => (
                    <option
                        key={opt.value}
                        value={opt.value}
                        className="bg-popover text-foreground"
                    >
                        {opt.label}
                    </option>
                ))}
            </select>
            <ChevronDown
                size={14}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none"
            />
        </div>
    </FieldShell>
);

interface SwitchFieldProps extends Omit<BaseFieldProps, "required"> {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    compact?: boolean;
}

/**
 * 开关行 — 整行可点击切换，开关右对齐。
 * 保留左右布局（开关天然适合右对齐），但把整行做成可点击区域，
 * 解决「光标需精确点到右侧开关」的可达性问题。
 */
export const SwitchField: React.FC<SwitchFieldProps> = ({
    label,
    description,
    error,
    className = "",
    checked,
    onChange,
    disabled,
    compact,
}) => {
    const handleToggle = () => {
        if (!disabled) onChange(!checked);
    };

    return (
        <div
            role="switch"
            aria-checked={checked}
            tabIndex={disabled ? -1 : 0}
            onClick={handleToggle}
            onKeyDown={(e) => {
                if ((e.key === " " || e.key === "Enter") && !disabled) {
                    e.preventDefault();
                    onChange(!checked);
                }
            }}
            className={`flex items-start justify-between gap-4 rounded-md px-3 ${
                compact ? "py-1" : "py-2"
            } -mx-3 cursor-pointer select-none transition-colors hover:bg-muted/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${className} ${
                disabled
                    ? "opacity-50 pointer-events-none cursor-not-allowed"
                    : ""
            }`}
        >
            {label && (
                <div className="flex-1 min-w-0">
                    <span className="text-sm text-foreground block break-words">
                        {label}
                    </span>
                    {description &&
                        <p className="text-[11px] text-muted-foreground/80 mt-0.5 break-words">
                            {description}
                        </p>}
                    {error &&
                        <p className="text-[10px] text-destructive mt-0.5">
                            {error}
                        </p>}
                </div>
            )}

            <Switch
                checked={checked}
                onChange={onChange}
                disabled={disabled}
            />
        </div>
    );
};

/**
 * 可搜索下拉框 - 用于大量选项的模型选择
 * 点击展开下拉，支持输入搜索过滤
 */
interface SearchableSelectFieldProps extends BaseFieldProps {
    value: string;
    onChange: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    emptyText?: string;
}

export const SearchableSelectField: React.FC<
    SearchableSelectFieldProps
> = ({
    label,
    description,
    error,
    required,
    className = "",
    value,
    onChange,
    options,
    placeholder = "请选择...",
    disabled,
    emptyText = "无可用选项",
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // 过滤选项
    const filteredOptions = options.filter((opt) =>
        opt.label.toLowerCase().includes(search.toLowerCase()) ||
        opt.value.toLowerCase().includes(search.toLowerCase())
    );

    // 当前选中的 label
    const selectedLabel = options.find((opt) => opt.value === value)?.label ||
        value || placeholder;

    // 点击外部关闭（仅在 isOpen 时绑定，避免多实例事件泄漏）
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
                setSearch("");
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () =>
            document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen]);

    // 打开时聚焦搜索框
    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    const handleSelect = (optValue: string) => {
        onChange(optValue);
        setIsOpen(false);
        setSearch("");
    };

    return (
        <div
            className={`flex flex-col gap-1.5 ${className}`}
            ref={containerRef}
        >
            {label &&
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    {label}
                    {required && <span className="text-destructive">*</span>}
                </label>}

            {/* 触发按钮 — 复用 fieldBox 观感 */}
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={`relative w-full text-left ${fieldBox} !pr-9 cursor-pointer`}
            >
                <span className={value ? "" : "text-muted-foreground/60"}>
                    {selectedLabel}
                </span>
                <ChevronDown
                    size={14}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 transition-transform ${
                        isOpen ? "rotate-180" : ""
                    }`}
                />
            </button>

            {/* 下拉面板 - 使用 glass-panel 实现正确的模糊效果 */}
            {isOpen && (
                <div
                    className="glass-panel absolute z-50 mt-1 w-full max-h-64 border border-border rounded-lg shadow-xl overflow-hidden flex flex-col"
                    style={{ left: 0, right: 0, top: "100%" }}
                >
                    {/* 搜索框 */}
                    <div className="p-2 border-b border-border flex items-center gap-2">
                        <Search
                            size={14}
                            className="text-muted-foreground flex-shrink-0"
                        />
                        <input
                            ref={inputRef}
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="搜索模型..."
                            className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/50"
                        />
                        {search && (
                            <button
                                type="button"
                                onClick={() => setSearch("")}
                                className="p-0.5 hover:bg-muted rounded"
                            >
                                <X
                                    size={12}
                                    className="text-muted-foreground"
                                />
                            </button>
                        )}
                    </div>

                    {/* 选项列表 */}
                    <div className="overflow-y-auto max-h-48">
                        {filteredOptions.length > 0
                            ? (
                                filteredOptions.map((opt) => (
                                    <div
                                        key={opt.value}
                                        onClick={() => handleSelect(opt.value)}
                                        className={`px-3 py-2 cursor-pointer text-sm truncate ${
                                            opt.value === value
                                                ? "bg-primary/15 text-primary"
                                                : "hover:bg-muted text-foreground"
                                        }`}
                                        title={opt.label}
                                    >
                                        {opt.label}
                                    </div>
                                ))
                            )
                            : (
                                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                                    {search ? "无匹配结果" : emptyText}
                                </div>
                            )}
                    </div>

                    {/* 选项计数 */}
                    {options.length > 10 && (
                        <div className="px-3 py-1 border-t border-border text-xs text-muted-foreground/70">
                            {filteredOptions.length} / {options.length} 个模型
                        </div>
                    )}
                </div>
            )}

            {description &&
                <p className="text-[11px] text-muted-foreground/70 break-words leading-relaxed">
                    {description}
                </p>}
            {error &&
                <p className="text-[11px] text-destructive break-words">
                    {error}
                </p>}
        </div>
    );
};

// ==================== 内部小组件 ====================

/**
 * FieldShell — 标签 + 控件 + 描述 + 错误 的统一外壳。
 * 所有输入型字段共用，消除「标签上、描述下、错误下」的重复包裹。
 * SwitchField 不用本组件（它需要整行可点击）。
 */
const FieldShell: React.FC<{
    label?: React.ReactNode;
    description?: React.ReactNode;
    error?: string;
    required?: boolean;
    className?: string;
    children: React.ReactNode;
}> = ({
    label,
    description,
    error,
    required,
    className = "",
    children,
}) => (
    <div className={`flex flex-col gap-1.5 ${className}`}>
        {label &&
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                {label}
                {required && <span className="text-destructive">*</span>}
            </label>}
        {children}
        {description &&
            <p className="text-[11px] text-muted-foreground/70 break-words leading-relaxed">
                {description}
            </p>}
        {error &&
            <p className="text-[11px] text-destructive break-words">
                {error}
            </p>}
    </div>
);
