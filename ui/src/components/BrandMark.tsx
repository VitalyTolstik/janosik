/**
 * The Janosik brand mark — the gradient square with the feather + sparkle
 * (the same markup the app header has always drawn inline). Shared so the
 * public share page (TASK-58) shows the exact same mark as the app instead
 * of an approximation; the hover animations key off a `.group` ancestor and
 * the `janosik-feather` / `janosik-sparkle` classes in index.css.
 */
export function BrandMark() {
  return (
    <div className="janosik-brand-tile relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-primary-foreground shadow-sm">
      <svg
        className="janosik-feather"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="janosik-feather-grad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.95" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.72" />
          </linearGradient>
        </defs>
        <path
          d="M14.086 18.412A2 2 0 0112.67 19H5v-7.672a2 2 0 01.586-1.414L11.75 3.75a6 6 0 118.49 8.49z"
          fill="url(#janosik-feather-grad)"
        />
        <path
          d="M16 8 2 22"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path
          d="M16.5 15H9"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.6"
        />
      </svg>
      <svg
        className="janosik-sparkle pointer-events-none absolute -right-0.5 -top-0.5 h-3 w-3"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
      >
        <path d="M12 0c.9 5.2 3.6 7.8 12 12-8.4 4.2-11.1 6.8-12 12-.9-5.2-3.6-7.8-12-12 8.4-4.2 11.1-6.8 12-12z" />
      </svg>
    </div>
  );
}
