import type { ReactNode } from 'react';

/**
 * Peças visuais compartilhadas, derivadas do design original.
 * Mantê-las aqui evita que cada tela reinvente botão, cartão e selo com
 * variações ligeiramente diferentes.
 */

export function PrimaryButton({
  children,
  onClick,
  type = 'button',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-[38px] cursor-pointer items-center gap-2 rounded-[10px] border-0 bg-linear-135 from-accent to-[#8B5CF6] px-4 text-[13px] font-medium text-white shadow-[0_6px_18px_rgba(91,108,255,0.28)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  danger,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-[38px] cursor-pointer rounded-[10px] border border-line-strong bg-transparent px-4 text-[13px] transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 ${
        danger ? 'text-[#FF7A86]' : 'text-[#B5B5CC]'
      }`}
    >
      {children}
    </button>
  );
}

export function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs transition-colors ${
        active
          ? 'border-accent/40 bg-accent/14 text-[#C9CDFF]'
          : 'border-[#23232F] bg-transparent text-ink-muted hover:text-ink-soft'
      }`}
    >
      {label}
    </button>
  );
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-line-mid bg-panel ${className}`}>
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">
      {children}
    </div>
  );
}

/** Selo de status usado em execuções e integrações. */
export function StatusPill({
  tone,
  children,
}: {
  tone: 'success' | 'danger' | 'neutral' | 'warning';
  children: ReactNode;
}) {
  const tones = {
    success: 'border-success/30 bg-success/10 text-[#4FD3A0]',
    danger: 'border-danger/30 bg-danger/10 text-[#FF7A86]',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    neutral: 'border-[#23232F] bg-transparent text-ink-dim',
  };
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full border px-[11px] py-1 text-[11.5px] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  help,
  children,
  required,
}: {
  label: string;
  help?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[11.5px] text-ink-muted">
        {label}
        {required && <span className="ml-1 text-danger">*</span>}
      </label>
      {children}
      {help && <p className="text-[11px] leading-relaxed text-ink-dim">{help}</p>}
    </div>
  );
}

const inputClass =
  'h-[42px] rounded-[11px] border border-line-strong bg-inset px-3.5 text-[13.5px] text-ink outline-none transition-colors focus:border-accent';

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full ${inputClass}`}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full resize-y rounded-[11px] border border-line-strong bg-inset px-3.5 py-3 text-[13.5px] leading-relaxed text-ink outline-none transition-colors focus:border-accent ${
        mono ? 'font-mono text-[12.5px]' : ''
      }`}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full cursor-pointer appearance-none ${inputClass}`}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`flex h-[19px] w-[34px] shrink-0 cursor-pointer rounded-full border-0 p-0.5 transition-colors ${
        checked ? 'justify-end bg-[#2E9E72]' : 'justify-start bg-[#262632]'
      }`}
    >
      <span
        className={`h-[15px] w-[15px] rounded-full transition-colors ${
          checked ? 'bg-[#E8FFF5]' : 'bg-[#7A7A94]'
        }`}
      />
    </button>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[#242430] bg-panel p-16 text-center">
      <div className="h-10 w-10 rounded-xl border border-[#242432] bg-[#14141F]" />
      <div className="font-display text-base font-semibold">{title}</div>
      <p className="max-w-[44ch] text-[13px] text-ink-dim">{description}</p>
      {action}
    </div>
  );
}

export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 p-12 text-[13px] text-ink-dim">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-accent"
      />
      {label}…
    </div>
  );
}

export function ErrorBanner({
  message,
  issues,
  onRetry,
}: {
  message: string;
  issues?: string[];
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger/8 p-4 text-[13px] text-[#FF9AA3]"
    >
      <div className="font-medium">{message}</div>
      {issues && issues.length > 0 && (
        <ul className="ml-4 list-disc space-y-1 text-[12.5px] opacity-90">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 w-fit cursor-pointer rounded-lg border border-danger/30 px-3 py-1.5 text-xs hover:bg-danger/10"
        >
          Tentar de novo
        </button>
      )}
    </div>
  );
}
