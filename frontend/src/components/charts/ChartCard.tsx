import { useWidgetView } from '../../hooks/useWidgetView';
import { ReactNode } from 'react';

interface Props {
  title: string;
  widgetId: string;
  children: ReactNode;
  action?: ReactNode;
  subtitle?: string;
}

export default function ChartCard({ title, widgetId, children, action, subtitle }: Props) {
  const ref = useWidgetView(widgetId);
  return (
    <div ref={ref} className="card card-hover p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="font-display text-lg text-ink-900 tracking-tight leading-none">{title}</h3>
          {subtitle && <div className="smallcaps mt-2">{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
