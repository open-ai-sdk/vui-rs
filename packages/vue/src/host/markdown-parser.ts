// Markdown → a plain block tree the `<markdown>` component maps to box/text/span.
// Parsing lives here (wrapping `marked`, the same lexer opencode and pi use) and
// stays Vue-free so it is unit-testable on its own. Inline formatting is folded
// into flat styled spans (`MdSpan`) — exactly what a `<text>`'s run flattener
// consumes — and fenced code is handed off to `<code>` by the component.
import { marked, type Token, type Tokens } from "marked";

/** An inline run with the formatting flags a `<span>` can carry. */
export interface MdSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  /** Inline `code` span — rendered with the code accent + subtle background. */
  code?: boolean;
  /** Link target (text is the visible label); rendered underlined. */
  href?: string;
}

export interface MdHeading {
  type: "heading";
  level: number;
  spans: MdSpan[];
}
export interface MdParagraph {
  type: "paragraph";
  spans: MdSpan[];
}
export interface MdCode {
  type: "code";
  text: string;
  lang?: string;
}
export interface MdListItem {
  spans: MdSpan[];
  /** Nested sub-list, if any. */
  children?: MdList;
}
export interface MdList {
  type: "list";
  ordered: boolean;
  start: number;
  items: MdListItem[];
}
export interface MdBlockquote {
  type: "blockquote";
  blocks: MdBlock[];
}
export interface MdHr {
  type: "hr";
}
export interface MdTable {
  type: "table";
  header: MdSpan[][];
  rows: MdSpan[][][];
}

export type MdBlock =
  | MdHeading
  | MdParagraph
  | MdCode
  | MdList
  | MdBlockquote
  | MdHr
  | MdTable;

/** Parse markdown source into a flat list of renderable blocks. */
export function parseMarkdown(content: string): MdBlock[] {
  if (!content) return [];
  return tokensToBlocks(marked.lexer(content));
}

function tokensToBlocks(tokens: Token[]): MdBlock[] {
  const blocks: MdBlock[] = [];
  for (const tok of tokens) {
    const block = tokenToBlock(tok);
    if (block) blocks.push(block);
  }
  return blocks;
}

function tokenToBlock(tok: Token): MdBlock | null {
  switch (tok.type) {
    case "heading": {
      const h = tok as Tokens.Heading;
      return { type: "heading", level: h.depth, spans: inlineSpans(h.tokens) };
    }
    case "paragraph": {
      const p = tok as Tokens.Paragraph;
      return { type: "paragraph", spans: inlineSpans(p.tokens) };
    }
    case "text": {
      // A loose top-level text token (e.g. between blocks) — render as a paragraph.
      const t = tok as Tokens.Text;
      const spans = t.tokens ? inlineSpans(t.tokens) : [{ text: t.text }];
      return { type: "paragraph", spans };
    }
    case "code": {
      const c = tok as Tokens.Code;
      return { type: "code", text: c.text, lang: c.lang || undefined };
    }
    case "list": {
      const l = tok as Tokens.List;
      return {
        type: "list",
        ordered: l.ordered,
        start: typeof l.start === "number" ? l.start : 1,
        items: l.items.map(listItem),
      };
    }
    case "blockquote": {
      const b = tok as Tokens.Blockquote;
      return { type: "blockquote", blocks: tokensToBlocks(b.tokens) };
    }
    case "hr":
      return { type: "hr" };
    case "table": {
      const t = tok as Tokens.Table;
      return {
        type: "table",
        header: t.header.map((cell) => inlineSpans(cell.tokens)),
        rows: t.rows.map((row) => row.map((cell) => inlineSpans(cell.tokens))),
      };
    }
    // space/html and anything unrecognized: no visible block.
    default:
      return null;
  }
}

function listItem(item: Tokens.ListItem): MdListItem {
  const spans: MdSpan[] = [];
  let children: MdList | undefined;
  for (const tok of item.tokens) {
    if (tok.type === "list") {
      const nested = tokenToBlock(tok);
      if (nested && nested.type === "list") children = nested;
    } else if (tok.type === "text" || tok.type === "paragraph") {
      const t = tok as Tokens.Text | Tokens.Paragraph;
      spans.push(...(t.tokens ? inlineSpans(t.tokens) : [{ text: t.text }]));
    }
  }
  return children ? { spans, children } : { spans };
}

/** Flatten inline tokens into styled spans, folding nested emphasis. */
function inlineSpans(tokens: Token[] | undefined): MdSpan[] {
  const out: MdSpan[] = [];
  if (tokens) collectInline(tokens, {}, out);
  return out.length > 0 ? out : [{ text: "" }];
}

type InlineStyle = Omit<MdSpan, "text">;

function collectInline(tokens: Token[], style: InlineStyle, out: MdSpan[]): void {
  for (const tok of tokens) {
    switch (tok.type) {
      case "text": {
        const t = tok as Tokens.Text;
        if (t.tokens && t.tokens.length > 0) collectInline(t.tokens, style, out);
        else pushSpan(out, t.text, style);
        break;
      }
      case "escape":
        pushSpan(out, (tok as Tokens.Escape).text, style);
        break;
      case "strong":
        collectInline((tok as Tokens.Strong).tokens, { ...style, bold: true }, out);
        break;
      case "em":
        collectInline((tok as Tokens.Em).tokens, { ...style, italic: true }, out);
        break;
      case "del":
        collectInline((tok as Tokens.Del).tokens, { ...style, strike: true }, out);
        break;
      case "codespan":
        pushSpan(out, (tok as Tokens.Codespan).text, { ...style, code: true });
        break;
      case "link": {
        const l = tok as Tokens.Link;
        const label = l.tokens && l.tokens.length > 0
          ? undefined
          : l.text;
        if (label !== undefined) pushSpan(out, label, { ...style, href: l.href });
        else collectInline(l.tokens, { ...style, href: l.href }, out);
        break;
      }
      case "br":
        pushSpan(out, "\n", style);
        break;
      case "image":
        pushSpan(out, (tok as Tokens.Image).text || (tok as Tokens.Image).href, style);
        break;
      default: {
        // Unknown inline with raw text (e.g. html): keep the text, drop markup.
        const raw = (tok as { text?: string; raw?: string }).text
          ?? (tok as { raw?: string }).raw;
        if (raw) pushSpan(out, raw, style);
      }
    }
  }
}

function pushSpan(out: MdSpan[], text: string, style: InlineStyle): void {
  if (!text) return;
  out.push({ ...style, text });
}
