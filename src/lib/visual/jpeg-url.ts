/** Accept storage URLs, data URLs, or legacy raw JPEG base64. */
export function jpegUrl(src?: string | null): string {
  if (!src) return "";
  if (
    src.startsWith("data:") ||
    src.startsWith("/") ||
    src.startsWith("blob:") ||
    src.startsWith("http://") ||
    src.startsWith("https://")
  ) {
    return src;
  }
  return `data:image/jpeg;base64,${src}`;
}
