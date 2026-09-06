import { Component, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { AsyncState } from './Primitives.jsx';
import { Button } from './Button.jsx';

export function RouteLoading({ label = 'Loading page' }) {
  return (
    <div className="ui-route-state" role="status" aria-live="polite">
      <span className="ui-spinner ui-spinner--large" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="ui-route-state ui-route-state--error">
        <AsyncState
          title="This page could not be loaded"
          tone="error"
          action={<Button onClick={() => window.location.reload()}>Reload page</Button>}
        >
          <p>Your information is safe. Check your connection and try again.</p>
        </AsyncState>
      </div>
    );
  }
}

export function RouteBoundary({ children }) {
  const location = useLocation();

  return (
    <AppErrorBoundary key={location.pathname}>
      <Suspense fallback={<RouteLoading />}>
        {children}
      </Suspense>
    </AppErrorBoundary>
  );
}

export function RouteFocusManager() {
  const location = useLocation();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const activeMain = document.querySelector(
        '.ui-swipe-route-frame:not([aria-hidden="true"]) #main-content'
      ) || document.getElementById('main-content');
      activeMain?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);

  return null;
}
