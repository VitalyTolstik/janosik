/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Public URL of the app — where the "Sign in" / "Create account" CTAs go. */
  readonly PUBLIC_APP_URL?: string;
  /** Contact / waitlist address used by the pricing CTAs. */
  readonly PUBLIC_CONTACT_EMAIL?: string;
  /**
   * Privacy-friendly analytics. Unset by default, so the site loads no
   * third-party script; set the domain (and optionally a custom script URL)
   * to enable Plausible/Umami-style, cookieless tracking.
   */
  readonly PUBLIC_ANALYTICS_DOMAIN?: string;
  readonly PUBLIC_ANALYTICS_SRC?: string;
}
