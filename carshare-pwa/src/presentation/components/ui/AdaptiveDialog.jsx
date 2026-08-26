import { useEffect, useId, useRef, useState } from 'react';
import { IconX } from '../icons.jsx';
import { IconButton } from './Button.jsx';

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function AdaptiveDialog({
  children,
  description,
  footer,
  onClose,
  open,
  title,
  triggerRef,
}) {
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return undefined;
    }

    if (!rendered || closing) return undefined;

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setRendered(false);
      return undefined;
    }

    setClosing(true);
    const timeout = window.setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, 160);
    return () => window.clearTimeout(timeout);
  }, [closing, open, rendered]);

  useEffect(() => {
    if (!rendered || closing) return undefined;

    returnFocusRef.current = triggerRef?.current || document.activeElement;
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelectorAll(FOCUSABLE) || [];
    (dialog?.querySelector('[data-autofocus]') || focusable[0] || dialog)?.focus();

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll(FOCUSABLE)];
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    document.body.classList.add('dialog-open');

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('dialog-open');
      returnFocusRef.current?.focus?.();
    };
  }, [closing, rendered, triggerRef]);

  if (!rendered) return null;

  return (
    <div
      className="ui-dialog-backdrop"
      aria-hidden={closing || undefined}
      data-closing={closing || undefined}
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) {
          setRendered(false);
          setClosing(false);
        }
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <section
        ref={dialogRef}
        className="ui-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="ui-dialog__grabber" aria-hidden="true" />
        <header className="ui-dialog__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <IconButton label="Close dialog" onClick={() => onCloseRef.current()}>
            <IconX size={20} aria-hidden="true" />
          </IconButton>
        </header>
        <div className="ui-dialog__body">{children}</div>
        {footer && <footer className="ui-dialog__footer">{footer}</footer>}
      </section>
    </div>
  );
}
