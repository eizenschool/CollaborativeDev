import { forwardRef } from 'react';

export function Button({
  children,
  className = '',
  disabled = false,
  loading = false,
  loadingLabel = 'Please wait',
  size = 'medium',
  type = 'button',
  variant = 'primary',
  ...props
}) {
  const classes = [
    'ui-button',
    `ui-button--${variant}`,
    `ui-button--${size}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      {...props}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="ui-spinner" aria-hidden="true" />}
      <span className="ui-button__content">{loading ? loadingLabel : children}</span>
    </button>
  );
}

export const IconButton = forwardRef(function IconButton({
  children,
  className = '',
  label,
  size = 'medium',
  type = 'button',
  variant = 'ghost',
  ...props
}, ref) {
  if (!label) {
    throw new Error('IconButton requires a label for accessibility.');
  }

  return (
    <button
      ref={ref}
      {...props}
      type={type}
      className={[
        'ui-icon-button',
        `ui-icon-button--${variant}`,
        `ui-icon-button--${size}`,
        className,
      ].filter(Boolean).join(' ')}
      aria-label={label}
      title={props.title || label}
    >
      {children}
    </button>
  );
});
