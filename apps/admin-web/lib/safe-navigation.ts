export function safeNextPath(value: string | null | undefined, fallback = '/'): string {
  if (
    value === undefined ||
    value === null ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.startsWith('/login')
  ) {
    return fallback;
  }

  return value;
}
