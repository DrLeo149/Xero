import PageHeader from './PageHeader';

interface Props {
  page: string;
  question: string;
  nextUp: string[];
}

export default function ComingSoon({ page, question, nextUp }: Props) {
  return (
    <div className="space-y-8">
      <PageHeader tag={page} title={question} />

      <div className="card p-10 max-w-2xl">
        <div className="smallcaps mb-4">Coming in the next build</div>
        <ul className="space-y-3">
          {nextUp.map((item, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-ink-700 leading-relaxed">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-600 mt-2 shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <div className="mt-8 pt-6 border-t hairline text-xs text-ink-400">
          The Pulse page is the landing page for now. It covers "am I ok?" - the other pages
          go deeper on each question.
        </div>
      </div>
    </div>
  );
}
