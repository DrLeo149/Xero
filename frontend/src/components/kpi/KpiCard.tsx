import { useWidgetView } from '../../hooks/useWidgetView';

interface Props {
  label: string;
  value: string;
  sub?: string;
  widgetId: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}

const toneColors = {
  default: 'text-ink-900',
  good: 'text-positive',
  warn: 'text-warning',
  bad: 'text-negative',
};

const subToneColors = {
  default: 'text-ink-400',
  good: 'text-positive',
  warn: 'text-warning',
  bad: 'text-negative',
};

export default function KpiCard({ label, value, sub, widgetId, tone = 'default' }: Props) {
  const ref = useWidgetView(widgetId);
  return (
    <div
      ref={ref}
      className="card card-hover p-5 flex flex-col justify-between min-h-[120px]"
    >
      <div className="smallcaps">{label}</div>
      <div className="mt-3">
        <div
          className={`font-display font-medium tracking-tight text-[34px] leading-none num ${toneColors[tone]}`}
        >
          {value}
        </div>
        {sub && (
          <div className={`mt-2 text-xs num ${subToneColors[tone]}`}>{sub}</div>
        )}
      </div>
    </div>
  );
}
