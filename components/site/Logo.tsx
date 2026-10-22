export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="16" fill="var(--color-panel-2)" />
        <path d="M14 34c4 0 4-12 8-12s4 22 8 22 4-30 8-30 4 22 8 22 4-6 8-6" fill="none" stroke="var(--color-lamp)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-display text-[1.15rem] font-semibold tracking-tight">VaniDial</span>
    </span>
  );
}
