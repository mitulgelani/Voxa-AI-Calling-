/**
 * The card a figure sits in: figure number top left, title top right, a hint and a live
 * readout along the bottom. Sentence case, no tracked capitals.
 */
export function Plate({
  fig, title, hint, readout, children, readoutRef,
}: {
  fig: string;
  title: string;
  hint: string;
  readout: string;
  children: React.ReactNode;
  readoutRef?: React.Ref<HTMLSpanElement>;
}) {
  return (
    <div className="iso vd-iso relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-[#101c2e]">
      <div className="pointer-events-none absolute inset-x-4 top-3 flex justify-between text-xs text-ink-3 sm:inset-x-5 sm:top-4">
        <span className="tnum">{fig}</span>
        <span>{title}</span>
      </div>
      <div className="px-1 pb-9 pt-8 sm:px-3">{children}</div>
      <div className="pointer-events-none absolute inset-x-4 bottom-3 flex items-end justify-between gap-4 text-xs sm:inset-x-5 sm:bottom-4">
        <span className="text-ink-3">{hint}</span>
        <span ref={readoutRef} className="tnum text-right text-ink-2" aria-live="polite">{readout}</span>
      </div>
    </div>
  );
}
