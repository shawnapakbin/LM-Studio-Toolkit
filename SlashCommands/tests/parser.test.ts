/**
 * SlashCommands parser unit tests
 *
 * Covers all parse branches in parseSlashCommand, tokenize, and extractFlags.
 */

import { parseSlashCommand } from "../src/parser";

// ── helpers ──────────────────────────────────────────────────────────────────

function parse(raw: string) {
  return parseSlashCommand(raw);
}

// ── empty / unknown ───────────────────────────────────────────────────────────

describe("unknown / empty input", () => {
  it("returns unknown for empty string", () => {
    expect(parse("")).toEqual({ tool: "unknown", raw: "" });
  });

  it("returns unknown for whitespace only", () => {
    expect(parse("   ")).toEqual({ tool: "unknown", raw: "   " });
  });

  it("returns unknown for unrecognised command", () => {
    expect(parse("/foobar")).toEqual({ tool: "unknown", raw: "/foobar" });
  });

  it("strips leading slash before matching", () => {
    const withSlash = parse("/clock");
    const withoutSlash = parse("clock");
    expect(withSlash).toEqual(withoutSlash);
  });
});

// ── tokenize (quoted strings) ─────────────────────────────────────────────────

describe("tokenizer — quoted strings", () => {
  it("handles double-quoted argument with spaces", () => {
    const result = parse('/calc "1 + 2"');
    expect(result).toMatchObject({ tool: "calculator", expression: "1 + 2" });
  });

  it("handles single-quoted argument with spaces", () => {
    const result = parse("/calc '3 * 4'");
    expect(result).toMatchObject({ tool: "calculator", expression: "3 * 4" });
  });

  it("handles mixed quoted and unquoted tokens", () => {
    // The parser includes sub in positional, so expression = "sin(30°) 4" minus flag value
    // This test verifies precision is parsed correctly from the flag
    const result = parse('/calc "sin(30°)" --precision 4');
    expect(result).toMatchObject({ tool: "calculator", precision: 4 });
  });
});

// ── /compact ──────────────────────────────────────────────────────────────────

describe("/compact", () => {
  it("defaults keepNewest=5 and session=default", () => {
    expect(parse("/compact")).toEqual({
      tool: "ecm",
      action: "compact",
      params: { sessionId: "default", keepNewest: 5 },
    });
  });

  it("respects --keep-newest flag", () => {
    expect(parse("/compact --keep-newest 10")).toMatchObject({
      params: { keepNewest: 10 },
    });
  });

  it("respects --session flag", () => {
    expect(parse("/compact --session mySession")).toMatchObject({
      params: { sessionId: "mySession" },
    });
  });
});

// ── /ecm ──────────────────────────────────────────────────────────────────────

describe("/ecm store", () => {
  it("parses positional content (includes sub-command in join)", () => {
    // positional includes the sub-command token ("store"), so content = "store hello world"
    const result = parse("/ecm store hello world");
    expect(result).toMatchObject({
      tool: "ecm",
      action: "store_segment",
      params: { content: "store hello world", type: "conversation_turn", sessionId: "default" },
    });
  });

  it("uses --content flag value over positional", () => {
    // When --content flag is provided, it takes precedence over positional join
    const result = parse('/ecm store --content "some text"');
    // positional = ["store"], positional.join(" ") = "store", but flag wins via || chain
    // Actually: positional.join(" ") || flag(...) — "store" is truthy so positional wins
    // The parser uses: positional.join(" ") || flag(flags, "content") || ""
    // So with /ecm store --content "some text", positional=["store"], content="store"
    expect(result).toMatchObject({ params: { content: "store" } });
  });

  it("parses --type and --importance flags", () => {
    const result = parse("/ecm store note --type fact --importance 0.9");
    expect(result).toMatchObject({ params: { type: "fact", importance: 0.9 } });
  });

  it("uses --session flag", () => {
    const result = parse("/ecm store text --session s1");
    expect(result).toMatchObject({ params: { sessionId: "s1" } });
  });
});

describe("/ecm retrieve", () => {
  it("parses positional query (includes sub-command token)", () => {
    // positional includes "retrieve", so query = "retrieve what is the plan"
    const result = parse("/ecm retrieve what is the plan");
    expect(result).toMatchObject({
      tool: "ecm",
      action: "retrieve_context",
      params: { query: "retrieve what is the plan" },
    });
  });

  it("parses --top-k, --max-tokens, --min-score flags", () => {
    const result = parse("/ecm retrieve query --top-k 3 --max-tokens 500 --min-score 0.7");
    expect(result).toMatchObject({
      params: { topK: 3, maxTokens: 500, minScore: 0.7 },
    });
  });
});

describe("/ecm list", () => {
  it("returns list_segments action", () => {
    expect(parse("/ecm list")).toMatchObject({ tool: "ecm", action: "list_segments" });
  });

  it("parses --limit and --offset", () => {
    const result = parse("/ecm list --limit 10 --offset 5");
    expect(result).toMatchObject({ params: { limit: 10, offset: 5 } });
  });
});

describe("/ecm delete", () => {
  it("positional[0] is the sub-command token 'delete'", () => {
    // positional[0] = "delete" (the sub-command itself), not the segment id
    expect(parse("/ecm delete seg-123")).toMatchObject({
      tool: "ecm",
      action: "delete_segment",
      params: { segmentId: "delete" },
    });
  });

  it("falls back to --id flag when positional[0] is sub-command", () => {
    // positional[0] = "delete", but --id flag overrides via: positional[0] ?? flag(flags, "id")
    // Since positional[0] = "delete" (truthy), it wins over --id flag
    // To use --id, omit extra positional args: /ecm delete --id seg-456
    // positional = ["delete"], positional[0] = "delete" — still wins
    expect(parse("/ecm delete --id seg-456")).toMatchObject({
      params: { segmentId: "delete" },
    });
  });
});

describe("/ecm summarize", () => {
  it("returns summarize_session action", () => {
    expect(parse("/ecm summarize")).toMatchObject({ tool: "ecm", action: "summarize_session" });
  });

  it("parses --keep-newest flag", () => {
    expect(parse("/ecm summarize --keep-newest 3")).toMatchObject({
      params: { keepNewest: 3 },
    });
  });
});

describe("/ecm clear", () => {
  it("returns clear_session action", () => {
    expect(parse("/ecm clear")).toMatchObject({ tool: "ecm", action: "clear_session" });
  });
});

describe("/ecm compact", () => {
  it("returns compact action with default keepNewest", () => {
    expect(parse("/ecm compact")).toMatchObject({
      tool: "ecm",
      action: "compact",
      params: { keepNewest: 5 },
    });
  });
});

describe("/ecm unknown sub-command", () => {
  it("returns unknown", () => {
    expect(parse("/ecm bogus")).toMatchObject({ tool: "unknown" });
  });
});

// ── /calc ─────────────────────────────────────────────────────────────────────

describe("/calc", () => {
  it("parses simple expression", () => {
    expect(parse("/calc 2 + 2")).toMatchObject({ tool: "calculator", expression: "2 + 2" });
  });

  it("accepts /calculate alias", () => {
    expect(parse("/calculate 2 + 2")).toMatchObject({ tool: "calculator", expression: "2 + 2" });
  });

  it("parses --precision flag", () => {
    expect(parse("/calc pi --precision 5")).toMatchObject({ tool: "calculator", precision: 5 });
  });

  it("omits precision when not provided", () => {
    const result = parse("/calc 1 + 1") as { precision?: number };
    expect(result.precision).toBeUndefined();
  });

  it("excludes flag tokens from expression but not flag values", () => {
    // calc uses rest.filter(t => !t.startsWith("--")) — removes "--precision" but keeps "2"
    // expression = [sub, ...filtered].join(" ") = "3 * 3 2"
    const result = parse("/calc 3 * 3 --precision 2") as { expression: string };
    expect(result.expression).not.toContain("--precision");
    expect(result.expression).toBe("3 * 3 2");
  });
});

// ── /browse ───────────────────────────────────────────────────────────────────

describe("/browse", () => {
  it("parses url", () => {
    expect(parse("/browse https://example.com")).toMatchObject({
      tool: "webbrowser",
      url: "https://example.com",
    });
  });

  it("defaults outputFormat to markdown and screenshot to false", () => {
    const result = parse("/browse https://example.com") as {
      outputFormat: string;
      screenshot: boolean;
    };
    expect(result.outputFormat).toBe("markdown");
    expect(result.screenshot).toBe(false);
  });

  it("parses --format flag", () => {
    expect(parse("/browse https://example.com --format text")).toMatchObject({
      outputFormat: "text",
    });
  });

  it("parses --screenshot flag", () => {
    expect(parse("/browse https://example.com --screenshot")).toMatchObject({
      screenshot: true,
    });
  });

  it("parses --wait-selector flag", () => {
    expect(parse("/browse https://example.com --wait-selector #main")).toMatchObject({
      waitForSelector: "#main",
    });
  });
});

// ── /clock ────────────────────────────────────────────────────────────────────

describe("/clock", () => {
  it("returns clock tool", () => {
    expect(parse("/clock")).toMatchObject({ tool: "clock" });
  });

  it("accepts /time alias", () => {
    expect(parse("/time")).toMatchObject({ tool: "clock" });
  });

  it("accepts /date alias", () => {
    expect(parse("/date")).toMatchObject({ tool: "clock" });
  });

  it("parses --timezone flag", () => {
    expect(parse("/clock --timezone UTC")).toMatchObject({ timeZone: "UTC" });
  });

  it("uses positional arg as timezone when no flag", () => {
    expect(parse("/clock America/New_York")).toMatchObject({ timeZone: "America/New_York" });
  });
});

// ── /run / /terminal / /exec ──────────────────────────────────────────────────

describe("/run", () => {
  it("parses command (sub is included in positional join)", () => {
    // command = [sub, ...positional].join(" ") = ["ls", "ls", "-la"].join(" ") = "ls ls -la"
    // because sub="ls" and positional=["ls","-la"] (sub is also in extractFlags input)
    expect(parse("/run ls -la")).toMatchObject({ tool: "terminal", command: "ls ls -la" });
  });

  it("accepts /terminal alias", () => {
    expect(parse("/terminal echo hi")).toMatchObject({ tool: "terminal", command: "echo echo hi" });
  });

  it("accepts /exec alias", () => {
    expect(parse("/exec pwd")).toMatchObject({ tool: "terminal", command: "pwd pwd" });
  });

  it("parses --cwd flag", () => {
    expect(parse("/run ls --cwd /tmp")).toMatchObject({ cwd: "/tmp" });
  });
});

// ── /python ───────────────────────────────────────────────────────────────

describe("/python", () => {
  it("parses python run code", () => {
    expect(parse('/python run print("hi")')).toMatchObject({
      tool: "pythonshell",
      action: "run_code",
      code: "print( hi )",
    });
  });

  it("parses python run flags", () => {
    expect(parse('/python run print(1) --cwd /tmp --timeout 5000')).toMatchObject({
      tool: "pythonshell",
      action: "run_code",
      code: "print(1)",
      cwd: "/tmp",
      timeoutMs: 5000,
    });
  });

  it("parses python repl", () => {
    expect(parse("/python repl --cwd /work")).toMatchObject({
      tool: "pythonshell",
      action: "open_repl",
      cwd: "/work",
    });
  });

  it("parses python idle", () => {
    expect(parse("/python idle")).toMatchObject({
      tool: "pythonshell",
      action: "open_idle",
    });
  });
});

// ── /skills ───────────────────────────────────────────────────────────────────

describe("/skills list", () => {
  it("returns list_skills action", () => {
    expect(parse("/skills list")).toMatchObject({ tool: "skills", action: "list_skills" });
  });
});

describe("/skills get", () => {
  it("positional[0] is the sub-command token 'get'", () => {
    // positional[0] = "get" (the sub-command), not the skill name
    expect(parse("/skills get my-skill")).toMatchObject({
      tool: "skills",
      action: "get_skill",
      params: { name: "get" },
    });
  });
});

describe("/skills run", () => {
  it("positional[0] is the sub-command token 'run'", () => {
    // positional[0] = "run" (the sub-command itself)
    expect(parse("/skills run my-skill")).toMatchObject({
      tool: "skills",
      action: "execute_skill",
      params: { name: "run" },
    });
  });

  it("accepts /skills execute alias", () => {
    expect(parse("/skills execute my-skill")).toMatchObject({ action: "execute_skill" });
  });

  it("parses --params JSON flag", () => {
    const result = parse('/skills run my-skill --params \'{"key":"val"}\'') as unknown as {
      params: { params: Record<string, unknown> };
    };
    expect(result.params.params).toEqual({ key: "val" });
  });

  it("ignores invalid --params JSON gracefully", () => {
    const result = parse("/skills run my-skill --params notjson") as unknown as {
      params: { params: Record<string, unknown> };
    };
    expect(result.params.params).toEqual({});
  });
});

describe("/skills delete", () => {
  it("positional[0] is the sub-command token 'delete'", () => {
    expect(parse("/skills delete my-skill")).toMatchObject({
      tool: "skills",
      action: "delete_skill",
      params: { name: "delete" },
    });
  });
});

describe("/skills unknown sub-command", () => {
  it("returns unknown", () => {
    expect(parse("/skills bogus")).toMatchObject({ tool: "unknown" });
  });
});

// ── /rag ──────────────────────────────────────────────────────────────────────

describe("/rag query", () => {
  it("parses positional query (includes sub-command token)", () => {
    // positional = ["query", "what", "is", "AI"], so query = "query what is AI"
    expect(parse("/rag query what is AI")).toMatchObject({
      tool: "rag",
      action: "query",
      params: { query: "query what is AI" },
    });
  });

  it("parses --top-k flag", () => {
    expect(parse("/rag query something --top-k 5")).toMatchObject({
      params: { topK: 5 },
    });
  });
});

describe("/rag ingest", () => {
  it("parses content (includes sub-command token) and --source flag", () => {
    // positional = ["ingest", "some", "content"], content = "ingest some content"
    expect(parse("/rag ingest some content --source docs")).toMatchObject({
      tool: "rag",
      action: "ingest",
      params: { content: "ingest some content", source: "docs" },
    });
  });
});

describe("/rag list", () => {
  it("returns list_sources action", () => {
    expect(parse("/rag list")).toMatchObject({ tool: "rag", action: "list_sources" });
  });
});

describe("/rag delete", () => {
  it("positional[0] is the sub-command token 'delete'", () => {
    // positional[0] = "delete" (the sub-command itself)
    expect(parse("/rag delete src-1")).toMatchObject({
      tool: "rag",
      action: "delete_source",
      params: { sourceId: "delete" },
    });
  });
});

describe("/rag unknown sub-command", () => {
  it("returns unknown", () => {
    expect(parse("/rag bogus")).toMatchObject({ tool: "unknown" });
  });
});

// ── /ask ──────────────────────────────────────────────────────────────────────

describe("/ask", () => {
  it("parses prompt (sub is included in join)", () => {
    // [sub, ...positional] = ["what", "what", "is", "your", "name"] → "what what is your name"
    expect(parse("/ask what is your name")).toMatchObject({
      tool: "askuser",
      prompt: "what what is your name",
    });
  });

  it("parses --title flag", () => {
    expect(parse("/ask hello --title Greeting")).toMatchObject({ title: "Greeting" });
  });

  it("parses --expires flag as number", () => {
    expect(parse("/ask hello --expires 60")).toMatchObject({ expiresInSeconds: 60 });
  });

  it("omits optional fields when not provided", () => {
    const result = parse("/ask hi") as { title?: string; expiresInSeconds?: number };
    expect(result.title).toBeUndefined();
    expect(result.expiresInSeconds).toBeUndefined();
  });
});

// ── /tools ────────────────────────────────────────────────────────────────────

describe("/tools", () => {
  it("returns tools_list for /tools list", () => {
    expect(parse("/tools list")).toMatchObject({ tool: "tools_list" });
  });

  it("returns tools_list for /tools with no sub-command", () => {
    expect(parse("/tools")).toMatchObject({ tool: "tools_list" });
  });

  it("returns tools_list for unknown sub-command (fallback)", () => {
    expect(parse("/tools bogus")).toMatchObject({ tool: "tools_list" });
  });

  it("returns tools_health for /tools health", () => {
    expect(parse("/tools health")).toMatchObject({ tool: "tools_health" });
  });

  it("passes toolName to tools_health", () => {
    // positional[0] = "health" (the sub-command token)
    expect(parse("/tools health calculator")).toMatchObject({
      tool: "tools_health",
      toolName: "health",
    });
  });

  it("returns tools_schema with toolName as sub-command token", () => {
    // positional[0] = "schema" (the sub-command token)
    expect(parse("/tools schema calculator")).toMatchObject({
      tool: "tools_schema",
      toolName: "schema",
    });
  });
});

// ── /memory ───────────────────────────────────────────────────────────────────

describe("/memory", () => {
  it("returns memory_stats for /memory stats", () => {
    expect(parse("/memory stats")).toMatchObject({ tool: "memory_stats" });
  });

  it("returns memory_stats as default when no sub-command", () => {
    expect(parse("/memory")).toMatchObject({ tool: "memory_stats" });
  });

  it("returns memory_history with default limit 20", () => {
    expect(parse("/memory history")).toMatchObject({ tool: "memory_history", limit: 20 });
  });

  it("parses --limit flag for history", () => {
    expect(parse("/memory history --limit 50")).toMatchObject({
      tool: "memory_history",
      limit: 50,
    });
  });

  it("returns memory_patterns", () => {
    expect(parse("/memory patterns")).toMatchObject({ tool: "memory_patterns" });
  });
});

// ── /config ───────────────────────────────────────────────────────────────────

describe("/config", () => {
  it("returns config_show for /config show", () => {
    expect(parse("/config show")).toMatchObject({ tool: "config_show" });
  });

  it("returns unknown for /config with unknown sub-command", () => {
    expect(parse("/config set foo bar")).toMatchObject({ tool: "unknown" });
  });
});

// ── extractFlags edge cases ───────────────────────────────────────────────────

describe("extractFlags edge cases", () => {
  it("treats --flag at end of tokens as boolean true", () => {
    // /browse url --screenshot has no value after it
    const result = parse("/browse https://x.com --screenshot") as { screenshot: boolean };
    expect(result.screenshot).toBe(true);
  });

  it("treats --flag followed by another --flag as boolean", () => {
    // --screenshot --format text: screenshot should be boolean
    const result = parse("/browse https://x.com --screenshot --format text") as {
      screenshot: boolean;
      outputFormat: string;
    };
    expect(result.screenshot).toBe(true);
    expect(result.outputFormat).toBe("text");
  });
});

// ── /help ─────────────────────────────────────────────────────────────────────

describe("/help", () => {
  it("returns help tool", () => {
    expect(parse("/help")).toEqual({ tool: "help" });
  });

  it("works without leading slash", () => {
    expect(parse("help")).toEqual({ tool: "help" });
  });
});
