/** Only Tidy's own page may call into main: the exact file it was loaded from, or in development the dev server's
 *  origin. A query or fragment on Tidy's own page is fine; any other file, or a look-alike path, isn't. */
export function trustedFrame(url: string | undefined, devUrl: string | undefined, rendererUrl: string): boolean {
  if (!url) return false;
  if (devUrl) {
    try {
      return new URL(url).origin === new URL(devUrl).origin;
    } catch {
      return false;
    }
  }
  return url.split(/[?#]/)[0] === rendererUrl;
}
