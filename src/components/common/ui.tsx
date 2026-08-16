/**
 * 自研轻量 UI 组件库（Tailwind 原子化）。
 * 提供：Button / IconButton / Input / Select / TextArea / ColorInput / Modal / Progress / Spinner / EmptyState / Toasts。
 * 视觉规范：slate 灰阶 + indigo 主色，极简专业。
 */
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { getToastIcon, useUiStore } from '../../store/useUiStore';

// ---------- Button ----------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 shadow-sm disabled:bg-primary-300',
  secondary: 'bg-white text-ink-700 border border-ink-200 hover:bg-ink-50 active:bg-ink-100 disabled:text-ink-300',
  ghost: 'bg-transparent text-ink-600 hover:bg-ink-100 active:bg-ink-200 disabled:text-ink-300',
  danger: 'bg-red-500 text-white hover:bg-red-600 active:bg-red-700 shadow-sm disabled:bg-red-300',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = 'primary', size = 'md', className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-not-allowed ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
      {...rest}
    />
  );
}

// ---------- IconButton ----------

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
}

export function IconButton({ label, active = false, className = '', type = 'button', children, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      title={label}
      aria-label={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${
        active ? 'bg-primary-100 text-primary-700' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-800'
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------- Input ----------

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

export function Input({ label, hint, className = '', id, ...rest }: InputProps) {
  const inputId = id ?? (label ? label.replace(/\s+/g, '-') : undefined);
  return (
    <label className="block min-w-0" htmlFor={inputId}>
      {label ? <span className="mb-1 block text-xs font-medium text-ink-500">{label}</span> : null}
      <input
        id={inputId}
        className={`h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-800 placeholder:text-ink-300 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 ${className}`}
        {...rest}
      />
      {hint ? <span className="mt-1 block text-xs text-ink-400">{hint}</span> : null}
    </label>
  );
}

// ---------- Select ----------

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export function Select({ label, className = '', id, children, ...rest }: SelectProps) {
  const selectId = id ?? (label ? label.replace(/\s+/g, '-') : undefined);
  return (
    <label className="block min-w-0" htmlFor={selectId}>
      {label ? <span className="mb-1 block text-xs font-medium text-ink-500">{label}</span> : null}
      <select
        id={selectId}
        className={`h-9 w-full rounded-lg border border-ink-200 bg-white px-2 text-sm text-ink-800 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 ${className}`}
        {...rest}
      >
        {children}
      </select>
    </label>
  );
}

// ---------- TextArea ----------

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export function TextArea({ label, className = '', id, ...rest }: TextAreaProps) {
  const areaId = id ?? (label ? label.replace(/\s+/g, '-') : undefined);
  return (
    <label className="block min-w-0" htmlFor={areaId}>
      {label ? <span className="mb-1 block text-xs font-medium text-ink-500">{label}</span> : null}
      <textarea
        id={areaId}
        className={`min-h-[72px] w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800 placeholder:text-ink-300 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 ${className}`}
        {...rest}
      />
    </label>
  );
}

// ---------- ColorInput ----------

export interface ColorInputProps {
  label?: string;
  value: string;
  onChange: (color: string) => void;
}

export function ColorInput({ label, value, onChange }: ColorInputProps) {
  return (
    <div className="flex items-center gap-2">
      {label ? <span className="text-xs font-medium text-ink-500">{label}</span> : null}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 cursor-pointer rounded border border-ink-200 bg-white p-0.5"
        aria-label={label ?? '颜色'}
      />
      <span className="font-mono text-xs text-ink-500">{value}</span>
    </div>
  );
}

// ---------- Modal ----------

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}

const modalWidths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

export function Modal({ open, title, onClose, children, width = 'md' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // 记录打开前的焦点元素，关闭后恢复（焦点管理）
    const lastActive = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // 锁定 body 滚动
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        // 焦点陷阱：Tab/Shift+Tab 在面板内循环
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !panel.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !panel.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    // 打开时聚焦面板内第一个可聚焦元素
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      lastActive?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-950/40 animate-fade-in" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full ${modalWidths[width]} rounded-xl bg-white shadow-pop animate-slide-up`}
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- Progress ----------

export interface ProgressProps {
  value: number; // 0-100
  label?: string;
  className?: string;
}

export function Progress({ value, label, className = '' }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={className}>
      {label ? (
        <div className="mb-1 flex items-center justify-between text-xs text-ink-500">
          <span>{label}</span>
          <span className="font-mono">{Math.round(clamped)}%</span>
        </div>
      ) : null}
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full rounded-full bg-primary-500 transition-[width] duration-200"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

// ---------- Spinner ----------

export function Spinner({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-ink-200 border-t-primary-500 ${className}`}
      style={{ width: size, height: size }}
      role="status"
      aria-label="加载中"
    />
  );
}

// ---------- EmptyState ----------

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
      {icon ? <div className="text-ink-300">{icon}</div> : null}
      <div>
        <p className="text-sm font-semibold text-ink-700">{title}</p>
        {description ? <p className="mt-1 text-xs text-ink-400">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

// ---------- Toasts ----------

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return createPortal(
    <div className="pointer-events-none fixed left-1/2 top-4 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-pop animate-toast-in ${
            t.kind === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : t.kind === 'success'
                ? 'border-green-200 bg-green-50 text-green-700'
                : t.kind === 'warning'
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-ink-200 bg-white text-ink-700'
          }`}
        >
          <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full bg-current text-[10px] font-bold text-white">
            {getToastIcon(t.kind)}
          </span>
          <span className="flex-1 break-words">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="flex-none rounded p-0.5 opacity-60 hover:opacity-100"
            aria-label="关闭提示"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
