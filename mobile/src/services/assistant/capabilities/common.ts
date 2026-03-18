export const getStringParam = (
  params: Record<string, unknown>,
  key: string
): string | undefined => {
  const value = params[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

export const getNumberParam = (
  params: Record<string, unknown>,
  key: string
): number | undefined => {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

export const getBooleanParam = (
  params: Record<string, unknown>,
  key: string
): boolean | undefined => {
  const value = params[key];
  return typeof value === 'boolean' ? value : undefined;
};

export const getObjectParam = (
  params: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined => {
  const value = params[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
};

export const parseDateLike = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const lower = value.trim().toLowerCase();
  const now = new Date();

  if (lower === 'today') {
    return now;
  }

  if (lower === 'tomorrow') {
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    return next;
  }

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const match = value.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.toLowerCase();

  if (meridiem === 'pm' && hour < 12) {
    hour += 12;
  }

  if (meridiem === 'am' && hour === 12) {
    hour = 0;
  }

  const date = new Date(now);
  date.setHours(hour, minute, 0, 0);
  return date;
};

export const getRangeFromParams = (
  params: Record<string, unknown>,
  fallbackDays = 1
): { startAt: Date; endAt: Date } => {
  const now = new Date();
  const explicitStart = parseDateLike(params.startAt);
  const explicitEnd = parseDateLike(params.endAt);
  const dateParam = parseDateLike(params.date);
  const days = getNumberParam(params, 'days') || fallbackDays;

  if (explicitStart && explicitEnd) {
    return {
      startAt: explicitStart,
      endAt: explicitEnd,
    };
  }

  const base = dateParam || explicitStart || now;
  const startAt = new Date(base);
  startAt.setHours(0, 0, 0, 0);
  const endAt = explicitEnd || new Date(startAt);
  if (!explicitEnd) {
    endAt.setDate(endAt.getDate() + Math.max(days, 1));
    endAt.setMilliseconds(endAt.getMilliseconds() - 1);
  }

  return { startAt, endAt };
};

export const formatShortDateTime = (value: string | null | undefined): string => {
  if (!value) {
    return 'unscheduled';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString([], {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });
};
