import { useEffect, useRef, useState } from 'react';
import { buildPeriodOptions, PeriodOption } from '../lib/period';

interface Props {
  value: string;
  onChange: (key: string) => void;
}

const GROUP_LABELS: Record<PeriodOption['group'], string> = {
  current: 'Current',
  quick: 'Quick ranges',
  year: 'Historical years',
  month: 'Historical months',
};

export default function PeriodSelector({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const options = buildPeriodOptions();
  const current = options.find((o) => o.key === value) ?? options[0];

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const groups: Array<PeriodOption['group']> = ['current', 'quick', 'year', 'month'];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 border hairline rounded-md bg-canvas-raised px-3 py-2 text-sm text-ink-900 hover:border-ink-300 transition-colors min-w-[180px] justify-between"
      >
        <span className="flex items-center gap-2">
          <span className="smallcaps">Period</span>
          <span className="font-medium">{current.label}</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" className={`text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M2 4.5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 card shadow-raised z-20 max-h-[420px] overflow-y-auto py-2">
          {groups.map((g) => {
            const items = options.filter((o) => o.group === g);
            if (items.length === 0) return null;
            return (
              <div key={g} className="mb-2 last:mb-0">
                <div className="smallcaps px-4 pt-2 pb-1">{GROUP_LABELS[g]}</div>
                {items.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => { onChange(o.key); setOpen(false); }}
                    className={`w-full text-left px-4 py-1.5 text-sm transition-colors ${
                      o.key === value
                        ? 'bg-accent-50 text-accent-700 font-medium'
                        : 'text-ink-700 hover:bg-canvas-sunken'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
