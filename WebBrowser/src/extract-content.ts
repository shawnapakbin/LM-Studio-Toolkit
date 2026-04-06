/// <reference lib="dom" />

/**
 * Self-contained DOM extraction function serialized into the Playwright browser context
 * via page.evaluate(). Must not reference any outer-scope variables.
 *
 * Exported as a named function so TypeScript can serialize it correctly via page.evaluate().
 */
export function extractContent(outputFormat: "text" | "markdown"): {
  title: string;
  content: string;
} {
  const title = document.title;

  // Remove noise subtrees
  for (const tag of ["script", "style", "noscript", "svg"]) {
    for (const el of Array.from(document.querySelectorAll(tag))) {
      el.remove();
    }
  }

  const lines: string[] = [];

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").trim();
      if (text) lines.push(text);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (outputFormat === "markdown") {
      if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag[1], 10);
        const prefix = "#".repeat(level) + " ";
        const text = (el.textContent ?? "").trim();
        if (text) lines.push(prefix + text);
        return;
      }
      if (tag === "a") {
        const href = el.getAttribute("href") ?? "";
        const text = (el.textContent ?? "").trim();
        if (text) lines.push(href ? `[${text}](${href})` : text);
        return;
      }
      if (tag === "li") {
        const text = (el.textContent ?? "").trim();
        if (text) lines.push(`- ${text}`);
        return;
      }
      if (tag === "strong" || tag === "b") {
        const text = (el.textContent ?? "").trim();
        if (text) lines.push(`**${text}**`);
        return;
      }
      if (tag === "em" || tag === "i") {
        const text = (el.textContent ?? "").trim();
        if (text) lines.push(`_${text}_`);
        return;
      }
    }

    for (const child of Array.from(node.childNodes)) {
      walk(child);
    }
  }

  if (document.body) walk(document.body);

  const content = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, content };
}
