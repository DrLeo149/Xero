import { useEffect, useRef, useState } from 'react';

/**
 * Slot-machine style number reveal for hero KPIs.
 *
 * Fires ONCE on first mount (when value first becomes non-null). Subsequent
 * value changes from refetches do NOT re-animate - just update silently.
 * This is intentional so background polling doesn't cause visual churn.
 *
 * How it works:
 * - Format the target value into a string (e.g. "$47,230").
 * - Split into characters. Non-digits ($, ',', '.', ' ', letters) render static.
 * - Each digit renders as a vertical reel: 0-9 stacked, translated with -Yem.
 * - Reels spin rapidly (one full cycle every ~600ms) until their per-column
 *   `stopAt` time, then ease into the final target digit. Leftmost digit stops
 *   first; each subsequent digit is staggered by `staggerPerDigit` ms.
 * - Once all columns have settled, we unmount the reels and render plain
 *   formatted text for cheapness + crisp rendering.
 */
export default function SlotNumber({
  value,
  format,
  duration = 1100,
  staggerPerDigit = 90,
  className,
  nullFallback = '-',
}: {
  value: number | null;
  format: (n: number) => string;
  /** Base spin time for the first digit column (leftmost). */
  duration?: number;
  /** Extra delay per digit column after the first. */
  staggerPerDigit?: number;
  nullFallback?: string;
  className?: string;
}) {
  // Background refetches must not re-animate. We gate on `[value === null]`
  // as the effect dep so only the null -> non-null transition re-fires;
  // subsequent value changes (refetches) don't. StrictMode double-invokes
  // effects in dev, so we do NOT use a ref guard here - the cleanup cancels
  // the first rAF and the second run starts a fresh one.
  const [elapsed, setElapsed] = useState(0);
  const [animating, setAnimating] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);

  useEffect(() => {
    if (value === null) return;

    const targetText = format(value);
    const digitCount = (targetText.match(/\d/g) ?? []).length;
    // Total runtime = spin base + last-column stagger + settle tail.
    const total = duration + Math.max(0, digitCount - 1) * staggerPerDigit + 220;

    setAnimating(true);
    startRef.current = performance.now();

    const tick = (now: number) => {
      const e = now - startRef.current;
      setElapsed(e);
      if (e < total) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        setAnimating(false);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // Only re-run on the null boundary. Refetches that change `value` from
    // one number to another are intentionally ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value === null]);

  if (value === null) {
    return <span className={className}>{nullFallback}</span>;
  }

  const targetText = format(value);

  // Post-animation (or never animated for some reason): crisp plain text.
  if (!animating) {
    return (
      <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {targetText}
      </span>
    );
  }

  // Mid-animation: render character by character, spinning digit columns.
  const chars = targetText.split('');
  let digitIdx = 0;
  return (
    <span
      className={className}
      style={{
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        display: 'inline-block',
      }}
    >
      {chars.map((ch, i) => {
        if (!/\d/.test(ch)) {
          // Static character - zero-width alignment via inline-block so it sits
          // on the same baseline as the digit columns.
          return (
            <span key={i} style={{ display: 'inline-block', verticalAlign: 'top' }}>
              {ch}
            </span>
          );
        }
        const idx = digitIdx++;
        // Leftmost (idx 0) stops at `duration`; each subsequent column stops
        // `staggerPerDigit` ms later. This creates the left-to-right cascade.
        const stopAt = duration + idx * staggerPerDigit;
        const target = Number(ch);
        return <Reel key={i} elapsed={elapsed} stopAt={stopAt} target={target} />;
      })}
    </span>
  );
}

/**
 * A single digit column. Renders 0-9 stacked vertically inside a 1em-tall
 * clipping window. Its translateY position is computed each frame from
 * `elapsed` so the parent's rAF loop drives the spin.
 */
function Reel({
  elapsed,
  stopAt,
  target,
}: {
  elapsed: number;
  stopAt: number;
  target: number;
}) {
  // 60ms per digit swap -> ~600ms per full 0-9 cycle. Feels rapid, reads as
  // a slot reel rather than a smooth counter.
  const cycleMs = 60;

  let y: number;
  if (elapsed < stopAt) {
    // Free spin: y grows linearly, wraps every 10 digits.
    y = (elapsed / cycleMs) % 10;
  } else {
    // Settle: ease from the last spinning position down to the target digit.
    // Always travel "downward" (increasing y) so the reel keeps its momentum
    // rather than reversing direction, which reads as glitchy.
    const settleDur = 200;
    const t = Math.min(1, (elapsed - stopAt) / settleDur);
    const eased = 1 - Math.pow(1 - t, 3);
    const lastY = (stopAt / cycleMs) % 10;
    let diff = target - lastY;
    while (diff < 0) diff += 10;
    y = lastY + diff * eased;
  }

  return (
    <span
      style={{
        display: 'inline-block',
        height: '1em',
        overflow: 'hidden',
        verticalAlign: 'top',
      }}
    >
      <span
        style={{
          display: 'block',
          transform: `translateY(${-y}em)`,
          willChange: 'transform',
        }}
      >
        {Array.from({ length: 21 }, (_, k) => (
          <span
            key={k}
            style={{ display: 'block', height: '1em', lineHeight: 1 }}
          >
            {k % 10}
          </span>
        ))}
      </span>
    </span>
  );
}
