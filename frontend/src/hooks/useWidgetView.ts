import { useEffect, useRef } from 'react';
import { track } from '../lib/telemetry';

/**
 * Fires a `widget_view` event the first time the referenced element
 * scrolls into the viewport. Used on every KPI card / chart so the
 * admin analytics can tell which widgets clients actually look at.
 */
export function useWidgetView(widget: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  const seen = useRef(false);
  useEffect(() => {
    if (!ref.current || seen.current) return;
    const el = ref.current;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !seen.current) {
            seen.current = true;
            track('widget_view', { widget });
            obs.disconnect();
          }
        }
      },
      { threshold: 0.5 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [widget]);
  return ref;
}
