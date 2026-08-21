export function nid(prefix: string): string {
  const raw =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${raw.slice(0, 16)}`;
}

export function sha256Hex(input: string): string {
  // Lightweight FNV-1a 32 + length mix for client; server overwrites with real sha.
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `h${(h >>> 0).toString(16).padStart(8, "0")}_${input.length.toString(16)}`;
}
