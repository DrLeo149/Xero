/**
 * Nav icons + brand mark. All 16×16, 1.5 stroke, currentColor - they
 * inherit the sidebar link color so active/hover states just work.
 *
 * Logo is a placeholder: a rounded square tile with a mini rising line -
 * meant to be swapped for a real asset later.
 */

type IconProps = { size?: number; className?: string };

const base = (size = 16) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

// Pulse → heartbeat line
export function PulseIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M1.5 8h2.5l1.5-4 2.5 8 1.8-5 1.2 2.5h3" />
    </svg>
  );
}

// Profit → trending up arrow
export function ProfitIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M1.5 12l4-4 3 3 5.5-6" />
      <path d="M9.5 5h4.5v4.5" />
    </svg>
  );
}

// Cash Flow → wallet with tab
export function CashIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="1.5" y="4" width="13" height="9" rx="1.5" />
      <path d="M10.5 8.5h4" />
      <circle cx="11.5" cy="8.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Customers → two heads
export function CustomersIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="6" cy="5.5" r="2.25" />
      <path d="M1.75 13c.5-2.5 2.2-3.75 4.25-3.75S9.75 10.5 10.25 13" />
      <path d="M10.5 8a2 2 0 100-4" />
      <path d="M11.5 13c-.1-1.4-.7-2.5-1.7-3.2.7-.35 1.4-.55 2.15-.55 2 0 3 1.25 3.5 3.75" />
    </svg>
  );
}

// Tailor / customize → sparkles emoji, renders inline at icon size.
// Uses a span instead of an svg so the emoji keeps its native colour.
export function TailorIcon({ size = 16, className }: IconProps) {
  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        fontSize: size,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      aria-hidden
    >
      ✨
    </span>
  );
}

// Settings → gear
export function SettingsIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.25 3.25l1.05 1.05M11.7 11.7l1.05 1.05M3.25 12.75l1.05-1.05M11.7 4.3l1.05-1.05" />
    </svg>
  );
}

// Tenants → building
export function TenantsIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2.5" y="2" width="11" height="12" rx="0.75" />
      <path d="M5 5h1.5M9.5 5H11M5 8h1.5M9.5 8H11M5 11h6" />
    </svg>
  );
}

// Analytics → bar chart
export function AnalyticsIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2 14V2" />
      <path d="M2 14h12" />
      <rect x="4" y="8" width="2" height="4" />
      <rect x="7.5" y="5" width="2" height="7" />
      <rect x="11" y="9" width="2" height="3" />
    </svg>
  );
}

/**
 * Brand mark - placeholder. A rounded tile with an upward line.
 * Uses the accent color for the fill and currentColor for the chart stroke
 * so it can sit on dark or light backgrounds.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-label="mynumbers">
      <rect x="1" y="1" width="26" height="26" rx="7" fill="var(--accent-600)" />
      <path
        d="M6 19l4.5-5 3.5 3 7.5-9"
        stroke="#ffffff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="21.5" cy="8" r="1.6" fill="#ffffff" />
    </svg>
  );
}
