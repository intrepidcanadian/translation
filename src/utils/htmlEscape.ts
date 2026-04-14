/**
 * Minimal HTML escape for values interpolated into a PDF template via expo-print.
 * Covers the characters that would break out of text content or attributes.
 * Keep this colocated with other pure string utils so PDF exporters across the
 * app (ConversationPlayback, history share, …) share one escape pass.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
