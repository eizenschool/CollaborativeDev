import { useCallback, useEffect, useRef } from 'react';
import {
  AnimatePresence,
  animate,
  LazyMotion,
  m,
  MotionConfig,
  useIsPresent,
  useMotionValue,
  useReducedMotion
} from 'motion/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  getPrimaryNavigationIndex,
  resolveSwipeDestination
} from '../nav/primaryNavigation.js';

const loadMotionFeatures = () => import('../../motionFeatures.js')
  .then((module) => module.default);

const HORIZONTAL_LOCK_PX = 12;
const MIN_FLICK_DISTANCE_PX = 36;
const MIN_FLICK_VELOCITY_PX_MS = 0.55;
const EDGE_GESTURE_INSET_PX = 20;
const PHONE_MAX_WIDTH_PX = 700;
const EXCLUDED_TARGETS = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'form',
  'iframe',
  'canvas',
  'video',
  'audio',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="dialog"]',
  '[role="slider"]',
  '[role="textbox"]',
  '[data-swipe-ignore]'
].join(',');

function hasHorizontalScroller(target, boundary) {
  let node = target instanceof Element ? target : null;
  while (node && node !== boundary) {
    const style = window.getComputedStyle(node);
    if (['auto', 'scroll'].includes(style.overflowX) && node.scrollWidth > node.clientWidth + 1) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

function shouldIgnoreTouch(target, boundary) {
  if (!(target instanceof Element)) return true;
  if (document.body.classList.contains('dialog-open')) return true;
  if (target.closest(EXCLUDED_TARGETS)) return true;
  if (hasHorizontalScroller(target, boundary)) return true;
  return window.getSelection?.()?.type === 'Range';
}

function swipeThreshold(viewportWidth) {
  return Math.min(96, Math.max(64, viewportWidth * 0.18));
}

function routeVariants(reducedMotion) {
  return {
    enter: (direction) => {
      if (reducedMotion || !direction) return { x: 0 };
      return { x: direction === 'next' ? 56 : -56 };
    },
    center: {
      x: 0,
      transition: { duration: reducedMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }
    },
    exit: (direction) => {
      if (reducedMotion || !direction) return { x: 0, transition: { duration: 0 } };
      return {
        x: direction === 'next' ? -64 : 64,
        transition: { duration: 0.14, ease: [0.4, 0, 1, 1] }
      };
    }
  };
}

function SwipeRouteFrame({ children, pathname, transitionDirection, onNavigate }) {
  const { user } = useAuth();
  const reducedMotion = useReducedMotion();
  const isPresent = useIsPresent();
  const frameRef = useRef(null);
  const surfaceRef = useRef(null);
  const gestureRef = useRef(null);
  const dragX = useMotionValue(0);

  useEffect(() => {
    if (frameRef.current) frameRef.current.inert = !isPresent;
  }, [isPresent]);

  const springBack = useCallback(() => {
    animate(dragX, 0, reducedMotion
      ? { duration: 0 }
      : { type: 'spring', stiffness: 520, damping: 38, mass: 0.65 });
  }, [dragX, reducedMotion]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !isPresent || getPrimaryNavigationIndex(pathname) < 0) return undefined;

    const resetGesture = () => {
      gestureRef.current = null;
    };

    const handleTouchStart = (event) => {
      if (window.innerWidth > PHONE_MAX_WIDTH_PX) return;
      if (event.touches.length !== 1 || shouldIgnoreTouch(event.target, surface)) return;
      const touch = event.touches[0];
      if (
        touch.clientX <= EDGE_GESTURE_INSET_PX
        || touch.clientX >= window.innerWidth - EDGE_GESTURE_INSET_PX
      ) return;

      gestureRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startAt: performance.now(),
        locked: null
      };
    };

    const handleTouchMove = (event) => {
      const gesture = gestureRef.current;
      if (!gesture || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (!gesture.locked && Math.max(absX, absY) >= HORIZONTAL_LOCK_PX) {
        gesture.locked = absX >= absY * 1.25 ? 'horizontal' : 'vertical';
      }
      if (gesture.locked === 'vertical') {
        resetGesture();
        springBack();
        return;
      }
      if (gesture.locked !== 'horizontal') return;

      event.preventDefault();
      const direction = deltaX < 0 ? 'next' : 'previous';
      const target = resolveSwipeDestination(pathname, direction, user);
      if (!target) {
        if (!reducedMotion) dragX.set(Math.sign(deltaX) * Math.min(24, absX * 0.18));
        return;
      }

      if (!reducedMotion) {
        const limit = Math.max(96, window.innerWidth * 0.36);
        dragX.set(Math.sign(deltaX) * Math.min(absX, limit));
      }
    };

    const handleTouchEnd = (event) => {
      const gesture = gestureRef.current;
      resetGesture();
      if (!gesture || gesture.locked !== 'horizontal' || event.changedTouches.length !== 1) {
        springBack();
        return;
      }

      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - gesture.startX;
      const distance = Math.abs(deltaX);
      const duration = Math.max(1, performance.now() - gesture.startAt);
      const velocity = distance / duration;
      const direction = deltaX < 0 ? 'next' : 'previous';
      const target = resolveSwipeDestination(pathname, direction, user);
      const committed = target && (
        distance >= swipeThreshold(window.innerWidth)
        || (distance >= MIN_FLICK_DISTANCE_PX && velocity >= MIN_FLICK_VELOCITY_PX_MS)
      );

      if (!committed) {
        springBack();
        return;
      }

      onNavigate(target);
    };

    const handleTouchCancel = () => {
      resetGesture();
      springBack();
    };

    surface.addEventListener('touchstart', handleTouchStart, { passive: true });
    surface.addEventListener('touchmove', handleTouchMove, { passive: false });
    surface.addEventListener('touchend', handleTouchEnd, { passive: true });
    surface.addEventListener('touchcancel', handleTouchCancel, { passive: true });
    return () => {
      surface.removeEventListener('touchstart', handleTouchStart);
      surface.removeEventListener('touchmove', handleTouchMove);
      surface.removeEventListener('touchend', handleTouchEnd);
      surface.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [dragX, isPresent, onNavigate, pathname, reducedMotion, springBack, user]);

  return (
    <m.div
      ref={frameRef}
      className="ui-swipe-route-frame"
      custom={transitionDirection}
      variants={routeVariants(reducedMotion)}
      initial="enter"
      animate="center"
      exit="exit"
      aria-hidden={!isPresent ? 'true' : undefined}
      style={!isPresent ? { position: 'absolute', inset: 0, pointerEvents: 'none' } : undefined}
    >
      <m.div ref={surfaceRef} className="ui-swipe-route-surface" style={{ x: dragX }}>
        {children}
      </m.div>
    </m.div>
  );
}

export default function SwipeRouteViewport({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const pendingDirectionRef = useRef(null);
  const transitionDirection = pendingDirectionRef.current;

  useEffect(() => {
    pendingDirectionRef.current = null;
  }, [location.pathname]);

  const handleNavigate = useCallback((target) => {
    pendingDirectionRef.current = target.direction;
    navigate(target.to, { state: target.state });
  }, [navigate]);

  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <MotionConfig reducedMotion="user">
        <div className="ui-swipe-route-stage">
          <AnimatePresence initial={false} custom={transitionDirection} mode="sync">
            <SwipeRouteFrame
              key={location.pathname}
              pathname={location.pathname}
              transitionDirection={transitionDirection}
              onNavigate={handleNavigate}
            >
              {children}
            </SwipeRouteFrame>
          </AnimatePresence>
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
