/** Copy query state for a URL write without restoring a stale language handoff. */
export function copySearchParamsWithoutLanguageHandoff(
  base: string | URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams(base);
  params.delete("lng");
  return params;
}
