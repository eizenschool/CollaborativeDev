// Watches window width to switch between mobile and desktop layouts, mirroring
// the pattern the rest of the app uses for its responsive screens. If your
// project already has a shared useIsDesktop hook (Module 2/1 mention one),
// feel free to delete this file and import that one instead - the props/return
// value (a boolean) are the same.
import { useEffect, useState } from 'react';

export function useIsDesktop(breakpoint = 1024) {
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