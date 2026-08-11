import fc from "fast-check";
import { getClockSnapshot } from "../../../../Clock/src/clock";

const validTimezones = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Pacific/Auckland",
  "America/Chicago",
  "Europe/Berlin",
  "Asia/Shanghai",
];

describe("Feature: mcp-common-plugin-injection", () => {
  /**
   * **Validates: Requirements 4.2**
   *
   * Property 3: Clock valid timezone response structure
   *
   * For any valid IANA timezone string, the `get_current_datetime` tool SHALL return a structured
   * response containing a valid ISO 8601 UTC timestamp, local time components (year, month, day,
   * hour, minute, second, millisecond, day of week), and timezone metadata (name, abbreviation, offset).
   */
  it("Property 3: Clock valid timezone response structure", () => {
    fc.assert(
      fc.property(fc.constantFrom(...validTimezones), (timeZone) => {
        const result = getClockSnapshot({ timeZone, locale: "en-US" });

        // Must succeed for valid timezones
        expect(result.success).toBe(true);

        if (!result.success) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (result as any).data;

        // UTC ISO 8601 timestamp validation
        expect(data.nowUtcIso).toBeDefined();
        expect(typeof data.nowUtcIso).toBe("string");
        expect(Date.parse(data.nowUtcIso)).not.toBeNaN();
        expect(data.nowUtcIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

        // Local time components - date
        expect(typeof data.date.year).toBe("number");
        expect(data.date.year).toBeGreaterThanOrEqual(2020);
        expect(typeof data.date.month).toBe("number");
        expect(data.date.month).toBeGreaterThanOrEqual(1);
        expect(data.date.month).toBeLessThanOrEqual(12);
        expect(typeof data.date.day).toBe("number");
        expect(data.date.day).toBeGreaterThanOrEqual(1);
        expect(data.date.day).toBeLessThanOrEqual(31);

        // Local time components - time
        expect(typeof data.time.hour).toBe("number");
        expect(data.time.hour).toBeGreaterThanOrEqual(0);
        expect(data.time.hour).toBeLessThanOrEqual(23);
        expect(typeof data.time.minute).toBe("number");
        expect(data.time.minute).toBeGreaterThanOrEqual(0);
        expect(data.time.minute).toBeLessThanOrEqual(59);
        expect(typeof data.time.second).toBe("number");
        expect(data.time.second).toBeGreaterThanOrEqual(0);
        expect(data.time.second).toBeLessThanOrEqual(59);
        expect(typeof data.time.millisecond).toBe("number");
        expect(data.time.millisecond).toBeGreaterThanOrEqual(0);
        expect(data.time.millisecond).toBeLessThanOrEqual(999);

        // Day of week
        expect(typeof data.date.weekday).toBe("string");
        expect(data.date.weekday.length).toBeGreaterThan(0);

        // Timezone metadata - name
        expect(typeof data.timezoneNameLong).toBe("string");
        expect(data.timezoneNameLong.length).toBeGreaterThan(0);

        // Timezone metadata - abbreviation
        expect(typeof data.timezoneNameShort).toBe("string");
        expect(data.timezoneNameShort.length).toBeGreaterThan(0);

        // Timezone metadata - offset
        expect(typeof data.timezoneOffsetMinutes).toBe("number");
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 4.4**
   *
   * Property 4: Clock invalid timezone rejection
   *
   * For any string that is not a valid IANA timezone identifier, the get_current_datetime tool
   * SHALL return a response with `success` set to `false` and an error message indicating
   * the timezone is invalid.
   */
  it("Property 4: Clock invalid timezone rejection", () => {
    // Known invalid timezone strings
    const knownInvalid = fc.constantFrom(
      "Invalid/Zone",
      "Not_A_Timezone",
      "Fake/City",
      "123",
      "America/FakeCity",
      "GARBAGE_TZ",
      "Foo/Bar/Baz",
      "XYZ",
      "Europe/Nowhere",
      "Antarctica/FakeBase",
    );

    // A small set of valid IANA timezones to filter against
    const validTimezonesSet = new Set([
      "UTC",
      "GMT",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Toronto",
      "America/Vancouver",
      "America/Mexico_City",
      "America/Sao_Paulo",
      "America/Argentina/Buenos_Aires",
      "Europe/London",
      "Europe/Paris",
      "Europe/Berlin",
      "Europe/Moscow",
      "Europe/Istanbul",
      "Asia/Tokyo",
      "Asia/Shanghai",
      "Asia/Kolkata",
      "Asia/Dubai",
      "Asia/Singapore",
      "Asia/Seoul",
      "Asia/Hong_Kong",
      "Australia/Sydney",
      "Australia/Melbourne",
      "Pacific/Auckland",
      "Pacific/Honolulu",
      "Africa/Cairo",
      "Africa/Johannesburg",
      "Africa/Lagos",
      "US/Eastern",
      "US/Central",
      "US/Mountain",
      "US/Pacific",
      "Canada/Eastern",
      "Canada/Pacific",
      "Etc/GMT",
      "Etc/UTC",
    ]);

    // Helper to check if a string is likely a valid timezone
    function isLikelyValidTimezone(s: string): boolean {
      if (validTimezonesSet.has(s)) return true;
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: s }).format(new Date());
        return true;
      } catch {
        return false;
      }
    }

    // Random strings that are filtered to exclude valid IANA timezones
    const randomInvalid = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => {
      // Exclude whitespace-only strings (they get trimmed to empty and use system default)
      if (s.trim().length === 0) return false;
      return !isLikelyValidTimezone(s.trim());
    });

    const invalidTimezoneArb = fc.oneof(knownInvalid, randomInvalid);

    fc.assert(
      fc.property(invalidTimezoneArb, (invalidTz) => {
        const result = getClockSnapshot({ timeZone: invalidTz, locale: "en-US" });

        // Must return failure
        expect(result.success).toBe(false);

        // Must have an error field that is a non-empty string
        if (!result.success) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const error = (result as any).error;
          expect(typeof error).toBe("string");
          expect(error.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
