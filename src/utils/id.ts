let counter = 0;

/** Short unique id; crypto.randomUUID is unavailable on insecure origins (e.g. LAN testing on mobile). */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && window.isSecureContext) {
    return crypto.randomUUID();
  }
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
