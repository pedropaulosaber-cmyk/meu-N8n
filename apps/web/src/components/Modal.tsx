import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Modal do design original, com o comportamento de acessibilidade que
 * um `<div>` sozinho não dá: fecha no Esc, devolve o foco ao elemento
 * que o abriu e prende o Tab dentro do diálogo enquanto está aberto.
 */
export function Modal({
  title,
  subtitle,
  children,
  footer,
  onClose,
  width = 620,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;

      // Mantém o foco circulando dentro do modal: sem isto, o Tab
      // escaparia para a página atrás, que está visualmente bloqueada.
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-80 flex items-center justify-center overflow-y-auto bg-[rgba(6,6,10,0.72)] p-10 backdrop-blur-[6px]"
      onMouseDown={(e) => {
        // Só fecha em clique no fundo — arrastar de dentro para fora não fecha.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width }}
        className="my-auto max-w-full overflow-hidden rounded-[20px] border border-line-strong bg-raised shadow-[0_40px_90px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#1A1A24] px-[26px] pb-[18px] pt-6">
          <div className="flex flex-col gap-1.5">
            <h2 className="m-0 font-display text-[18px] font-semibold tracking-[-0.02em]">
              {title}
            </h2>
            {subtitle && <p className="m-0 text-[12.5px] text-ink-dim">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[9px] border border-[#242432] bg-overlay text-ink-muted transition-colors hover:bg-[#1C1C26] hover:text-ink"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-[26px] py-[22px]">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-[#1A1A24] bg-surface px-[26px] py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
