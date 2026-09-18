// Watches window width to switch between mobile and desktop layouts, mirroring
// the pattern the rest of the app uses for its responsive screens. If your
// project already has a shared useIsDesktop hook (Module 2/1 mention one),
// feel free to delete this file and import that one instead - the props/return
// value (a boolean) are the same.
//
// 1100px is the shared "wide grids and multi-column layouts" breakpoint from
// docs/ai/UI.md. This used to default to 1024px, so between 1024 and 1100 the
// trip screens reflowed into two columns while the rest of the app was still
// in its narrower layout.
import { useEffect, useState } from 'react';

export function useIsDesktop(breakpoint = 1100) {
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= breakpoint : false
  );

  useEffect(() => {
    function handleResize() {
      setIsDesktop(window.innerWidth >= breakpoint);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);

  return isDesktop;
}