import { getAuthUrl, getRegionUrl } from "../src/utils";

describe("getRegionUrl", () => {
  it("returns SFO URL for undefined", () => {
    expect(getRegionUrl(undefined)).toBe("https://production-sfo.browserless.io");
  });

  it("returns SFO URL for empty string", () => {
    expect(getRegionUrl("")).toBe("https://production-sfo.browserless.io");
  });

  it("returns SFO URL for 'production-sfo'", () => {
    expect(getRegionUrl("production-sfo")).toBe("https://production-sfo.browserless.io");
  });

  it("returns LON URL for 'production-lon'", () => {
    expect(getRegionUrl("production-lon")).toBe("https://production-lon.browserless.io");
  });

  it("returns AMS URL for 'production-ams'", () => {
    expect(getRegionUrl("production-ams")).toBe("https://production-ams.browserless.io");
  });

  it("passes through a full https URL unchanged", () => {
    expect(getRegionUrl("https://custom.browserless.io")).toBe("https://custom.browserless.io");
  });

  it("passes through a full http URL unchanged", () => {
    expect(getRegionUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("auto-prefixes unknown region names with https://", () => {
    expect(getRegionUrl("production-ca")).toBe("https://production-ca.browserless.io");
    expect(getRegionUrl("staging")).toBe("https://staging.browserless.io");
  });

  it("all known regions produce fully-qualified URLs starting with https://", () => {
    const regions = ["production-sfo", "production-lon", "production-ams"];
    for (const r of regions) {
      expect(getRegionUrl(r)).toMatch(/^https:\/\//);
    }
  });
});

describe("getAuthUrl", () => {
  it("returns empty string for undefined", () => {
    expect(getAuthUrl(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(getAuthUrl("")).toBe("");
  });

  it("returns ?token= query string for a key", () => {
    expect(getAuthUrl("mykey123")).toBe("?token=mykey123");
  });

  it("URL-encodes special characters in the key", () => {
    expect(getAuthUrl("key with spaces")).toBe("?token=key%20with%20spaces");
    expect(getAuthUrl("key+plus=equals")).toBe("?token=key%2Bplus%3Dequals");
  });
});
