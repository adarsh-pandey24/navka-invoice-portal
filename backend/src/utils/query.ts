// Shared helpers for parsing list/report query strings.

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const containsRegex = (value: string): RegExp => new RegExp(escapeRegex(value), 'i');

export const queryString = (raw: unknown): string => (typeof raw === 'string' ? raw.trim() : '');

export const parsePositiveInt = (raw: unknown, fallback: number, min = 1, max = 100): number => {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

export const parseOptionalNumber = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Parses a date filter. `YYYY-MM-DD` is read as a calendar day in server local time
 * (new Date('YYYY-MM-DD') would be UTC midnight and shift the day on non-UTC servers).
 * Returns undefined for invalid input so a bad filter never reaches MongoDB.
 */
export const parseFilterDate = (raw: unknown, endOfDay = false): Date | undefined => {
  const value = queryString(raw);
  if (!value) return undefined;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = ymd ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else if (ymd) d.setHours(0, 0, 0, 0);
  return d;
};

export const buildDateRange = (start: unknown, end: unknown): { $gte?: Date; $lte?: Date } | undefined => {
  const range: { $gte?: Date; $lte?: Date } = {};
  const from = parseFilterDate(start);
  const to = parseFilterDate(end, true);
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return Object.keys(range).length ? range : undefined;
};

export const buildNumberRange = (min: unknown, max: unknown): { $gte?: number; $lte?: number } | undefined => {
  const range: { $gte?: number; $lte?: number } = {};
  const lo = parseOptionalNumber(min);
  const hi = parseOptionalNumber(max);
  if (lo !== undefined) range.$gte = lo;
  if (hi !== undefined) range.$lte = hi;
  return Object.keys(range).length ? range : undefined;
};

/** `PENDING,PARTIAL` -> ['PENDING','PARTIAL'], keeping only allowed values. */
export const parseEnumList = <T extends string>(raw: unknown, allowed: readonly T[]): T[] =>
  queryString(raw)
    .toUpperCase()
    .split(',')
    .map((v) => v.trim())
    .filter((v): v is T => (allowed as readonly string[]).includes(v));
