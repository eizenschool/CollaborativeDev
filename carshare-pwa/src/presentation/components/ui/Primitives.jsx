export function PageShell({
  as: Component = 'section',
  children,
  className = '',
  size = 'content',
  ...props
}) {
  return (
    <Component
      {...props}
      className={['ui-page-shell', `ui-page-shell--${size}`, className].filter(Boolean).join(' ')}
    >
      {children}
    </Component>
  );
}

export function PageHeader({
  actions,
  children,
  className = '',
  eyebrow,
  title,
}) {
  return (
    <header className={['ui-page-header', className].filter(Boolean).join(' ')}>
      <div className="ui-page-header__copy">
        {eyebrow && <p className="ui-page-header__eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {children && <div className="ui-page-header__description">{children}</div>}
      </div>
      {actions && <div className="ui-page-header__actions">{actions}</div>}
    </header>
  );
}

export function Card({ as: Component = 'section', children, className = '', ...props }) {
  return (
    <Component {...props} className={['ui-card', className].filter(Boolean).join(' ')}>
      {children}
    </Component>
  );
}

export function StatusBadge({ children, className = '', tone = 'neutral', ...props }) {
  return (
    <span
      {...props}
      className={['ui-status-badge', `ui-status-badge--${tone}`, className].filter(Boolean).join(' ')}
    >
      {children}
    </span>
  );
}

export function Field({
  children,
  className = '',
  error,
  hint,
  htmlFor,
  label,
  required = false,
}) {
  const hintId = htmlFor && hint ? `${htmlFor}-hint` : undefined;
  const errorId = htmlFor && error ? `${htmlFor}-error` : undefined;

  return (
    <div className={['ui-field', error && 'ui-field--error', className].filter(Boolean).join(' ')}>
      <label htmlFor={htmlFor}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {required && <span className="sr-only"> required</span>}
      </label>
      {hint && <p className="ui-field__hint" id={hintId}>{hint}</p>}
      {children}
      {error && <p className="ui-field__error" id={errorId} role="alert">{error}</p>}
    </div>
  );
}

export function AsyncState({
  action,
  children,
  className = '',
  compact = false,
  icon,
  live = false,
  title,
  tone = 'neutral',
}) {
  return (
    <div
      className={[
        'ui-async-state',
        `ui-async-state--${tone}`,
        compact && 'ui-async-state--compact',
        className,
      ].filter(Boolean).join(' ')}
      role={tone === 'error' ? 'alert' : undefined}
      aria-live={live ? 'polite' : undefined}
    >
      {icon && <div className="ui-async-state__icon" aria-hidden="true">{icon}</div>}
      <div className="ui-async-state__copy">
        <h2>{title}</h2>
        {children && <div>{children}</div>}
      </div>
      {action && <div className="ui-async-state__action">{action}</div>}
    </div>
  );
}
