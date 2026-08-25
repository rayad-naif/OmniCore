const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const URL_RE = /^https?:\/\/.+/;

export function isValidHex(value: string): boolean {
  return HEX_RE.test(value);
}

export function isValidOrigin(value: string): boolean {
  return URL_RE.test(value.trim());
}
