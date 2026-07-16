import * as path from "node:path";
import * as fc from "fast-check";

/**
 * Feature: browserless-schema-bugs
 * Property 1: Bug Condition - Schema Descriptions Contain Inaccurate or Missing Documentation
 *
 * This test asserts the EXPECTED (fixed) behavior of SAFE_SCHEMAS.
 * On UNFIXED code, these tests MUST FAIL — failure confirms the bugs exist.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
 */

// Load SAFE_SCHEMAS directly from the schema-proxy module
const schemaProxyPath = path.resolve(__dirname, "..", "scripts", "schema-proxy.js");
const { SAFE_SCHEMAS } = require(schemaProxyPath);

// The 5 affected tool/param combinations
type BugCase = {
  tool: string;
  param: string;
  check: (schemas: Record<string, any>) => boolean;
};

const BUG_CASES: BugCase[] = [
  {
    tool: "browserless_search",
    param: "limit",
    check: (schemas) => {
      const desc: string = schemas.browserless_search?.properties?.limit?.description ?? "";
      return desc.toLowerCase().includes("tier");
    },
  },
  {
    tool: "browserless_function",
    param: "code",
    check: (schemas) => {
      const desc: string = schemas.browserless_function?.properties?.code?.description ?? "";
      return desc.includes("about:blank") && desc.includes("page.goto");
    },
  },
  {
    tool: "browserless_export",
    param: "waitForSelector",
    check: (schemas) => {
      const props = schemas.browserless_export?.properties ?? {};
      return props.waitForSelector?.type === "string" && props.waitForTimeout?.type === "number";
    },
  },
  {
    tool: "browserless_crawl",
    param: "maxPages",
    check: (schemas) => {
      const desc: string = schemas.browserless_crawl?.properties?.maxPages?.description ?? "";
      return desc.toLowerCase().includes("sitemap") || desc.toLowerCase().includes("soft cap");
    },
  },
  {
    tool: "browserless_crawl",
    param: "url (redirect)",
    check: (schemas) => {
      const desc: string = schemas.browserless_crawl?.properties?.url?.description ?? "";
      return desc.toLowerCase().includes("redirect");
    },
  },
];

describe("Feature: browserless-schema-bugs, Property 1: Bug Condition Exploration", () => {
  test("all affected tool/param schemas contain accurate documentation", () => {
    fc.assert(
      fc.property(fc.constantFrom(...BUG_CASES), (bugCase: BugCase) => {
        const result = bugCase.check(SAFE_SCHEMAS);
        expect(result).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // Individual assertions for clear counterexample reporting
  test("browserless_search.limit description mentions tier-dependent limits", () => {
    const desc: string = SAFE_SCHEMAS.browserless_search?.properties?.limit?.description ?? "";
    expect(desc.toLowerCase()).toContain("tier");
  });

  test("browserless_function.code description mentions about:blank and page.goto", () => {
    const desc: string = SAFE_SCHEMAS.browserless_function?.properties?.code?.description ?? "";
    expect(desc).toContain("about:blank");
    expect(desc).toContain("page.goto");
  });

  test("browserless_export has waitForSelector (string) and waitForTimeout (number)", () => {
    const props = SAFE_SCHEMAS.browserless_export?.properties ?? {};
    expect(props.waitForSelector).toBeDefined();
    expect(props.waitForSelector?.type).toBe("string");
    expect(props.waitForTimeout).toBeDefined();
    expect(props.waitForTimeout?.type).toBe("number");
  });

  test("browserless_crawl.maxPages description mentions sitemap or soft cap", () => {
    const desc: string = SAFE_SCHEMAS.browserless_crawl?.properties?.maxPages?.description ?? "";
    const hasSitemap = desc.toLowerCase().includes("sitemap");
    const hasSoftCap = desc.toLowerCase().includes("soft cap");
    expect(hasSitemap || hasSoftCap).toBe(true);
  });

  test("browserless_crawl.url description mentions redirect behavior", () => {
    const desc: string = SAFE_SCHEMAS.browserless_crawl?.properties?.url?.description ?? "";
    expect(desc.toLowerCase()).toContain("redirect");
  });
});
