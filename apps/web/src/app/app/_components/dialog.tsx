"use client";

import type { ReactNode } from "react";
import { useEffect, useId } from "react";

type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "default" | "wide";
  onClose: () => void;
};

export function Dialog({ open, title, description, children, footer, size = "default", onClose }: DialogProps) {
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="mr-dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className={`mr-dialog${size === "wide" ? " mr-dialog--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mr-dialog__header">
          <div>
            <h2 id={titleId} className="mr-dialog__title">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mr-dialog__description">
                {description}
              </p>
            ) : null}
          </div>
          <button type="button" className="mr-dialog__close" onClick={onClose} aria-label="关闭">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="mr-dialog__body">{children}</div>
        {footer ? <div className="mr-dialog__footer">{footer}</div> : null}
      </div>
    </div>
  );
}

type NameDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  value: string;
  submitLabel: string;
  busy?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
};

export function NameDialog({
  open,
  title,
  description,
  label,
  placeholder,
  value,
  submitLabel,
  busy,
  onChange,
  onSubmit,
  onClose
}: NameDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={() => {
        if (busy) return;
        onClose();
      }}
      footer={
        <>
          <button type="button" className="mr-btn mr-btn--ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="mr-btn mr-btn--primary" onClick={onSubmit} disabled={busy || !value.trim()}>
            {busy ? "提交中…" : submitLabel}
          </button>
        </>
      }
    >
      <label className="mr-field">
        <span className="mr-field__label">{label}</span>
        <input
          autoFocus
          className="mr-input"
          value={value}
          placeholder={placeholder}
          maxLength={120}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy && value.trim()) onSubmit();
          }}
        />
      </label>
    </Dialog>
  );
}
