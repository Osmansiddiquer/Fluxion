import { useCallback, useRef, useState, type RefObject } from 'react';

/**
 * Track an element's content-box size via ResizeObserver, using a callback ref so
 * the observer re-attaches whenever the element mounts/unmounts (e.g. a panel that
 * is collapsed and reopened). Returns [refCallback, size, elementRef].
 */
export function useElementSize<T extends HTMLElement>(): [
  (el: T | null) => void,
  { w: number; h: number },
  RefObject<T | null>,
] {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const elRef = useRef<T | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  const setRef = useCallback((el: T | null) => {
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    elRef.current = el;
    if (el) {
      const ro = new ResizeObserver((entries) => {
        const r = entries[0].contentRect;
        setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
      });
      ro.observe(el);
      roRef.current = ro;
    }
  }, []);

  return [setRef, size, elRef];
}
