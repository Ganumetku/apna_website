import { useEffect, useState, type RefObject } from 'react';

/**
 * Lazy rendering: true while the element is within `rootMargin` of the
 * scroll container. Pages outside it unmount their PDF.js canvas and Fabric
 * editor, so memory stays flat no matter how many pages the PDF has.
 */
export function useInView(
  ref: RefObject<Element | null>,
  root: RefObject<Element | null> | null,
  rootMargin = '600px 0px',
): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setInView(entry.isIntersecting);
      },
      { root: root?.current ?? null, rootMargin, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, root, rootMargin]);

  return inView;
}
