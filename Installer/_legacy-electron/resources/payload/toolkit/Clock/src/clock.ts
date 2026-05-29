import { isValidTimeZone, normalizeLocale } from "./policy";

export type ClockRequest = {
  timeZone?: string;
  locale?: string;
};

export type ClockData = {
  requestedTimeZone: string;
  resolvedTimeZone: string;
  locale: string;
  nowUtcIso: string;
  nowInTimeZoneIsoLike: string;
  unixMs: number;
  unixSeconds: number;
  timezoneOffsetMinutes: number;
  timezoneNameShort: string;
  timezoneNameLong: string;
  date: {
    year: number;
    month: number;
    day: number;
    weekday: string;
  };
  time: {
    hour: number;
    minute: number;
    second: number;
    millisecond: number;
  };
};

type ClockResult = { success: true; data: ClockData } | { success: false; error: string };

function getOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = dtf.formatToParts(date);
  const values = {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
    hour: Number(parts.find((part) => part.type === "hour")?.value),
    minute: Number(parts.find((part) => part.type === "minute")?.value),
    second: Number(parts.find((part) => part.type === "second")?.value),
  };

  const asUtcMs = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
  );
  return Math.round((asUtcMs - date.getTime()) / 60000);
}

function getTimeZoneNames(
  date: Date,
  locale: string,
  timeZone: string,
): { short: string; long: string } {
  const shortFormatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    timeZoneName: "short",
  });
  const longFormatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    timeZoneName: "long",
  });

  const shortPart =
    shortFormatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value ??
    timeZone;
  const longPart =
    longFormatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value ??
    timeZone;

  return {
    short: shortPart,
    long: longPart,
  };
}

function getDateAndTimeParts(
  date: Date,
  locale: string,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
} {
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);

  const getPart = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: Number(getPart("year")),
    month: Number(getPart("month")),
    day: Number(getPart("day")),
    hour: Number(getPart("hour")),
    minute: Number(getPart("minute")),
    second: Number(getPart("second")),
    weekday: getPart("weekday"),
  };
}

function toIsoLikeInTimeZone(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  ms: number,
): string {
  const pad = (value: number, length = 2): string => String(value).padStart(length, "0");
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}.${pad(ms, 3)}`;
}

export function getClockSnapshot(request: ClockRequest): ClockResult {
  const now = new Date();
  const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const requestedTimeZone =
    request.timeZone?.trim() || process.env.CLOCK_DEFAULT_TIMEZONE?.trim() || systemTimeZone;

  if (!isValidTimeZone(requestedTimeZone)) {
    return {
      success: false,
      error: `Invalid IANA timezone '${requestedTimeZone}'. Example values: 'UTC', 'America/New_York', 'Asia/Kolkata'.`,
    };
  }

  const locale = normalizeLocale(request.locale?.trim() || process.env.CLOCK_DEFAULT_LOCALE);
  const parts = getDateAndTimeParts(now, locale, requestedTimeZone);
  const offsetMinutes = getOffsetMinutes(now, requestedTimeZone);
  const timeZoneNames = getTimeZoneNames(now, locale, requestedTimeZone);

  return {
    success: true,
    data: {
      requestedTimeZone,
      resolvedTimeZone: requestedTimeZone,
      locale,
      nowUtcIso: now.toISOString(),
      nowInTimeZoneIsoLike: toIsoLikeInTimeZone(parts, now.getMilliseconds()),
      unixMs: now.getTime(),
      unixSeconds: Math.floor(now.getTime() / 1000),
      timezoneOffsetMinutes: offsetMinutes,
      timezoneNameShort: timeZoneNames.short,
      timezoneNameLong: timeZoneNames.long,
      date: {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        weekday: parts.weekday,
      },
      time: {
        hour: parts.hour,
        minute: parts.minute,
        second: parts.second,
        millisecond: now.getMilliseconds(),
      },
    },
  };
}
