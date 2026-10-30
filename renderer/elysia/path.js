// Minimal browser path shim — only the functions the elysia renderer uses.
export function basename(p) {
  p = String(p || '');
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}
export function dirname(p) {
  p = String(p || '');
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '.';
}
export function join(...parts) {
  return parts.map((x) => String(x).replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
}
export function resolve(...parts) {
  return join(...parts);
}
export default { basename, dirname, join, resolve };
