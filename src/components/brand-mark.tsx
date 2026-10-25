/** A small, reusable cup and fresh leaf mark; decorative beside the product name. */
export function BrandMark({ className = "brand-symbol" }: { className?: string }) {
  return (
    <svg className={className} width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <path d="M7 13h18l-2.2 13H9.2L7 13Z" fill="var(--primary-soft, #EAF5ED)" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M6 13h20M11 19h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 11c-1-5 3.1-7.5 8-7-1.4 4.7-3.8 7.1-8 7Z" fill="var(--accent, #E6AA50)" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="m16 11 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
