import { useEffect, useRef, type ReactNode } from 'react';

export function Dialog({
  children,
  labelledBy,
  describedBy,
  className = 'modal',
  blocked,
  onClose,
}: {
  children: ReactNode;
  labelledBy: string;
  describedBy?: string;
  className?: string;
  blocked: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  const isBlocked = useRef(blocked);
  close.current = onClose;
  isBlocked.current = blocked;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const buttons = () => [
      ...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
    ];
    (buttons()[0] ?? dialog.current)?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBlocked.current) {
        event.preventDefault();
        close.current();
      }
      if (event.key === 'Tab') {
        const items = buttons(),
          first = items[0],
          last = items.at(-1);
        if (!items.length) {
          event.preventDefault();
          dialog.current?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      previous?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop">
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={className}
      >
        {children}
      </section>
    </div>
  );
}
