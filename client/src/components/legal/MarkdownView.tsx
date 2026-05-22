/**
 * client/src/components/legal/MarkdownView.tsx
 *
 * Lightweight markdown renderer used by the legal-doc page and the
 * blocking acceptance modal.
 *
 * Why hand-rolled?
 *  - `react-markdown` is not in deps and adding it would require sign-off
 *    (PR scope = no new npm packages without approval).
 *  - The legal documents (Terms / Privacy / AUP) are well-controlled
 *    markdown that we author ourselves — a tiny subset (headings, bold,
 *    italics, code spans, links, lists, paragraphs) covers everything we
 *    need to render without sanitising arbitrary user content.
 *  - Source is whitelisted to `GET /api/legal/{slug}` which the BE owns,
 *    so we're not rendering attacker-controlled markdown.
 *
 * If a richer renderer is needed later, swap the body with `react-markdown`
 * — the prop shape (`source: string`) stays the same.
 */
import { useMemo } from "react";

interface MarkdownViewProps {
  source: string;
  className?: string;
}

// HTML-escape so even our trusted source can't accidentally inject tags
// via a hyphen in a heading or angle-brackets in code spans.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert inline-markdown spans (bold, italic, code, links) to HTML.
 * Order matters — code-span first so `*` inside backticks is preserved.
 */
function renderInline(text: string): string {
  let out = escapeHtml(text);
  // `code` span
  out = out.replace(/`([^`]+)`/g, (_m, body) => `<code class="rounded bg-stone-100 px-1 py-0.5 text-[0.9em]">${body}</code>`);
  // [link](url) — http(s) only; ignore mailto: etc. to keep the surface tight.
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_m, label, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-indigo-700 underline hover:text-indigo-900">${label}</a>`;
  });
  // bold **text**
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // italic _text_ or *text* (single-star only, after bold)
  out = out.replace(/(^|\s)\*([^*\s][^*]*?)\*(?=\s|$|[.,;:!?])/g, "$1<em>$2</em>");
  out = out.replace(/(^|\s)_([^_\s][^_]*?)_(?=\s|$|[.,;:!?])/g, "$1<em>$2</em>");
  return out;
}

interface Block {
  type: "h1" | "h2" | "h3" | "p" | "ul" | "ol" | "hr";
  text?: string;
  items?: string[];
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  let buffer: string[] = [];

  const flushParagraph = () => {
    if (buffer.length === 0) return;
    blocks.push({ type: "p", text: buffer.join(" ").trim() });
    buffer = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph();
      i++;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushParagraph();
      blocks.push({ type: "h3", text: trimmed.slice(4) });
      i++;
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushParagraph();
      blocks.push({ type: "h2", text: trimmed.slice(3) });
      i++;
      continue;
    }
    if (trimmed.startsWith("# ")) {
      flushParagraph();
      blocks.push({ type: "h1", text: trimmed.slice(2) });
      i++;
      continue;
    }

    // unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // paragraph accumulation
    buffer.push(trimmed);
    i++;
  }
  flushParagraph();
  return blocks;
}

function renderBlocks(blocks: Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "h1":
        parts.push(`<h1 class="mt-6 mb-3 text-2xl font-bold tracking-tight text-stone-900">${renderInline(b.text!)}</h1>`);
        break;
      case "h2":
        parts.push(`<h2 class="mt-6 mb-2 text-xl font-semibold text-stone-900">${renderInline(b.text!)}</h2>`);
        break;
      case "h3":
        parts.push(`<h3 class="mt-4 mb-2 text-base font-semibold text-stone-900">${renderInline(b.text!)}</h3>`);
        break;
      case "p":
        parts.push(`<p class="my-3 text-sm leading-6 text-stone-700">${renderInline(b.text!)}</p>`);
        break;
      case "ul":
        parts.push(
          `<ul class="my-3 list-disc space-y-1 pl-6 text-sm text-stone-700">${b.items!
            .map((it) => `<li>${renderInline(it)}</li>`)
            .join("")}</ul>`,
        );
        break;
      case "ol":
        parts.push(
          `<ol class="my-3 list-decimal space-y-1 pl-6 text-sm text-stone-700">${b.items!
            .map((it) => `<li>${renderInline(it)}</li>`)
            .join("")}</ol>`,
        );
        break;
      case "hr":
        parts.push(`<hr class="my-4 border-stone-200" />`);
        break;
    }
  }
  return parts.join("");
}

export function MarkdownView({ source, className }: MarkdownViewProps) {
  const html = useMemo(() => renderBlocks(parseBlocks(source ?? "")), [source]);
  return (
    <div
      className={className}
      // Source is whitelisted to /api/legal/{slug} which the BE controls;
      // we also escape every span via escapeHtml() before re-injecting our
      // own structural tags, so inline HTML from the markdown body cannot
      // reach the DOM.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
