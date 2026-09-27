export function resolveApiKey(header, configured) {
  const candidate = typeof header === 'string' && header.trim() ? header.trim() : configured?.trim();
  return candidate && /^[^\s]+$/.test(candidate) && candidate.length <= 512 ? candidate : null;
}
