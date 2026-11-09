/**
 * Concentric-square animated background for the auth screens.
 *
 * The pattern is an SVG tile: three nested square outlines repeating every
 * 180 px. It is decorative only (aria-hidden), sits behind the form and
 * animates via the `.auth-background` CSS layer. No raster assets.
 */
export function AuthBackground() {
  return (
    <div className="auth-background" aria-hidden="true">
      <svg
        className="auth-background__pattern"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <pattern
            id="auth-concentric-squares"
            width="180"
            height="180"
            patternUnits="userSpaceOnUse"
          >
            <rect
              x="20"
              y="20"
              width="120"
              height="120"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
            <rect
              x="45"
              y="45"
              width="70"
              height="70"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
            <rect
              x="70"
              y="70"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#auth-concentric-squares)" />
      </svg>
    </div>
  );
}
