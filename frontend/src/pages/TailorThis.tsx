import PageHeader from '../components/PageHeader';

/**
 * "Tailor this" - a soft upsell page. Two asks handled in one destination:
 * (1) free 30-min expert review of their numbers, (2) optional custom
 * dashboard build if the standard view isn't right for their business.
 * One CTA, one mailto fallback, no forms, no friction.
 *
 * Intentionally *not* a modal or a banner - it's a destination the user
 * walks to when they want it, not a pop-up that interrupts them.
 */

const BOOKING_MAILTO =
  'mailto:adarsh@ankyadvisors.com?subject=Free%2030-min%20review%20via%20mynumbers&body=Hi%20Adarsh%2C%0A%0AI%27d%20like%20to%20book%20a%20free%2030-min%20review%20of%20my%20numbers.%0A%0A-%20Best%20time%3A%20%0A-%20What%20I%27d%20like%20to%20discuss%3A%20%0A%0AThanks!';

export default function TailorThis() {
  return (
    <div className="space-y-8">
      <PageHeader
        tag="Tailor this"
        title="Make this dashboard yours"
        meta={<>Built for general use. Tuneable for <span className="text-ink-900">your</span> business.</>}
      />

      {/* Hero pitch + primary CTA */}
      <section className="card p-8">
        <div className="max-w-2xl">
          <div className="smallcaps">The standard view</div>
          <h2 className="font-display text-[26px] text-ink-900 tracking-tight leading-tight mt-2">
            Every business is different. Your dashboard should be too.
          </h2>
          <p className="text-sm text-ink-500 leading-relaxed mt-4">
            The metrics you're looking at right now use general formulas. A healthy DSO for a
            SaaS company is different from a construction firm. A studio doesn't care about the
            same things as a logistics business. And the charts that matter most to you might
            not even be on this page yet.
          </p>
          <p className="text-sm text-ink-500 leading-relaxed mt-3">
            We can fix that. Start with a free 30-minute call with a senior advisor. If the
            standard view already covers what you need, we'll say so. If it doesn't, we'll build
            one that does.
          </p>

          <div className="mt-7 flex items-center gap-4 flex-wrap">
            <a
              href={BOOKING_MAILTO}
              className="rounded-md px-5 py-2.5 text-sm font-medium text-white bg-[#166534] hover:bg-[#115029] border border-[#0D3E20] transition-colors inline-flex items-center gap-2"
            >
              Book a free 30-min review
              <span aria-hidden>→</span>
            </a>
            <span className="text-[11px] text-ink-400">No pitch. No obligation.</span>
          </div>
        </div>
      </section>

      {/* What you get - three tiles */}
      <section>
        <div className="smallcaps mb-3">What the call covers</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card p-5">
            <div className="smallcaps">01</div>
            <h3 className="font-display text-[16px] text-ink-900 tracking-tight mt-2">
              A real review of your actual numbers
            </h3>
            <p className="text-xs text-ink-500 leading-relaxed mt-3">
              A senior advisor (not a bot, not a sales rep) walks through your live data, flags
              2-3 things that stand out, and answers whatever you have on your mind.
            </p>
          </div>
          <div className="card p-5">
            <div className="smallcaps">02</div>
            <h3 className="font-display text-[16px] text-ink-900 tracking-tight mt-2">
              Insights you keep either way
            </h3>
            <p className="text-xs text-ink-500 leading-relaxed mt-3">
              You walk away with concrete observations and suggestions whether or not you decide
              to work with us further. The 30 minutes are for you.
            </p>
          </div>
          <div className="card p-5">
            <div className="smallcaps">03</div>
            <h3 className="font-display text-[16px] text-ink-900 tracking-tight mt-2">
              A path forward if you want one
            </h3>
            <p className="text-xs text-ink-500 leading-relaxed mt-3">
              If the standard dashboard isn't the right fit, we can scope a tailored version -
              custom KPIs, your industry's benchmarks, charts that match how you think.
            </p>
          </div>
        </div>
      </section>

      {/* What "tailored" can mean */}
      <section className="card p-7">
        <div className="smallcaps mb-2">If you go further</div>
        <h2 className="font-display text-[20px] text-ink-900 tracking-tight leading-none">
          What a tailored setup looks like
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
          <div>
            <div className="text-[13px] font-medium text-ink-900">Custom KPIs</div>
            <p className="text-xs text-ink-500 leading-relaxed mt-1">
              Replace the generic metrics with the ones that actually drive your business -
              utilisation rate, revenue per head, project margin, recurring revenue split.
              Whatever you track on a napkin, we put on the dashboard.
            </p>
          </div>
          <div>
            <div className="text-[13px] font-medium text-ink-900">Industry benchmarks</div>
            <p className="text-xs text-ink-500 leading-relaxed mt-1">
              See how your numbers compare to similar businesses in your sector and size band,
              instead of the generic "under 45 days is healthy" rules of thumb.
            </p>
          </div>
          <div>
            <div className="text-[13px] font-medium text-ink-900">Charts built around your model</div>
            <p className="text-xs text-ink-500 leading-relaxed mt-1">
              Product-mix breakdowns, cohort retention, pipeline-to-revenue, customer
              concentration - whatever maps to how your business actually makes money.
            </p>
          </div>
          <div>
            <div className="text-[13px] font-medium text-ink-900">Ongoing advisory (optional)</div>
            <p className="text-xs text-ink-500 leading-relaxed mt-1">
              A monthly or quarterly review with a senior advisor who already knows your numbers,
              so you don't have to re-explain your business every time.
            </p>
          </div>
        </div>
      </section>

      {/* Bottom CTA - same link, in case they scrolled past the first one */}
      <section className="card p-6 text-center">
        <div className="smallcaps">Ready when you are</div>
        <h2 className="font-display text-[20px] text-ink-900 tracking-tight mt-2">
          30 minutes. Free. Useful regardless of what you decide.
        </h2>
        <div className="mt-5">
          <a
            href={BOOKING_MAILTO}
            className="rounded-md px-5 py-2.5 text-sm font-medium text-white bg-[#166534] hover:bg-[#115029] border border-[#0D3E20] transition-colors inline-flex items-center gap-2"
          >
            Book a free 30-min review
            <span aria-hidden>→</span>
          </a>
          <div className="text-[11px] text-ink-400 mt-3">
            or email <span className="text-ink-700">adarsh@ankyadvisors.com</span> directly
          </div>
        </div>
      </section>
    </div>
  );
}
