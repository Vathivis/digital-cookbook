import { useLayoutEffect, useRef } from 'react';

/**
 * Lightweight FLIP (First-Last-Invert-Play) animation hook for lists.
 * Call register(id) as a ref on each stable keyed element (wrapping element) inside a list/grid.
 * When the order / filtering changes, surviving elements smoothly translate to their new positions.
 */
export interface UseFlipListOptions {
  /** ms for movement animation */
  duration?: number;
  /** css easing */
  easing?: string;
  /** also fade / scale newly inserted items */
  animateEnter?: boolean;
  /** initial scale for entering items */
  enterScaleFrom?: number;
  /** animate items leaving (filtering out) */
  animateExit?: boolean;
  /** final scale for exit */
  exitScaleTo?: number;
}

interface InternalElInfo {
  el: HTMLElement;
  isNew?: boolean;
}

export function useFlipList(ids: (string | number)[], opts: UseFlipListOptions = {}) {
  const { duration = 300, easing = 'cubic-bezier(.25,.8,.25,1)', animateEnter = true, enterScaleFrom = 0.92, animateExit = true, exitScaleTo = 0.92 } = opts;
  const elementsRef = useRef<Map<string | number, InternalElInfo>>(new Map());
  const prevRectsRef = useRef<Map<string | number, DOMRect> | null>(null);
  const firstRenderRef = useRef(true);
  const idLookupRef = useRef<Set<string | number>>(new Set(ids));
  const idsSignatureRef = useRef(ids.join('|'));
  const idsSignature = ids.join('|');

  if (idsSignatureRef.current !== idsSignature) {
    idLookupRef.current = new Set(ids);
    idsSignatureRef.current = idsSignature;
  }

  function register(id: string | number) {
    return (el: HTMLElement | null) => {
      if (el) {
        elementsRef.current.set(id, { el, isNew: firstRenderRef.current ? false : !prevRectsRef.current?.has(id) });
      } else {
        elementsRef.current.delete(id);
      }
    };
  }

  useLayoutEffect(() => {
    const current = elementsRef.current;
    const newRects = new Map<string | number, DOMRect>();
    current.forEach((info, id) => {
      newRects.set(id, info.el.getBoundingClientRect());
    });

    const prevRects = prevRectsRef.current;
    if (prevRects) {
      const exiting: (string | number)[] = [];
      prevRects.forEach((_rect, id) => {
        if (!current.has(id) && idLookupRef.current.has(id) === false) {
          exiting.push(id);
        }
      });
      
      if (animateExit && exiting.length) {
        exiting.forEach(id => {
          const rect = prevRects.get(id);
          if (!rect) return;
          
          const ghost = document.createElement('div');
          ghost.style.position = 'absolute';
          ghost.style.left = rect.left + window.scrollX + 'px';
          ghost.style.top = rect.top + window.scrollY + 'px';
          ghost.style.width = rect.width + 'px';
          ghost.style.height = rect.height + 'px';
          ghost.style.borderRadius = '0.5rem';
          ghost.style.background = 'var(--card, rgba(255,255,255,0.04))';
          ghost.style.boxSizing = 'border-box';
          ghost.style.zIndex = '5';
          ghost.style.opacity = '1';
          ghost.style.transform = 'scale(1)';
          ghost.style.transition = `transform ${duration}ms ${easing}, opacity ${duration}ms ${easing}`;
          document.body.appendChild(ghost);
          
          requestAnimationFrame(() => {
            ghost.style.opacity = '0';
            ghost.style.transform = `scale(${exitScaleTo})`;
          });
          
          const cleanup = () => {
            ghost.removeEventListener('transitionend', cleanup);
            ghost.remove();
          };
          ghost.addEventListener('transitionend', cleanup);
        });
      }
    }
    if (prevRects) {
      current.forEach((info, id) => {
        const prev = prevRects.get(id);
        const last = newRects.get(id);
        if (!prev || !last) return;
        const dx = prev.left - last.left;
        const dy = prev.top - last.top;
        if (dx || dy) {
          const el = info.el;
            el.style.transition = 'none';
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            el.style.willChange = 'transform';
            requestAnimationFrame(() => {
              el.style.transition = `transform ${duration}ms ${easing}, opacity ${duration}ms ${easing}`;
              el.style.transform = '';
              const cleanup = () => {
                el.style.transition = '';
                el.style.willChange = '';
                el.removeEventListener('transitionend', cleanup);
              };
              el.addEventListener('transitionend', cleanup);
            });
        }
      });
    }

    if (animateEnter && prevRects) {
      current.forEach(info => {
        if (info.isNew) {
          const el = info.el;
          el.style.opacity = '0';
          el.style.transformOrigin = '50% 50%';
          el.style.transform = `scale(${enterScaleFrom})`;
          el.style.transition = 'none';
          requestAnimationFrame(() => {
            el.style.transition = `transform ${duration}ms ${easing}, opacity ${duration}ms ${easing}`;
            el.style.opacity = '1';
            el.style.transform = '';
            const cleanup = () => {
              el.style.transition = '';
              el.removeEventListener('transitionend', cleanup);
            };
            el.addEventListener('transitionend', cleanup);
          });
        }
      });
    }

    prevRectsRef.current = newRects;
    firstRenderRef.current = false;
  }, [idsSignature, duration, easing, animateEnter, enterScaleFrom, animateExit, exitScaleTo]);

  return { register };
}

export default useFlipList;
