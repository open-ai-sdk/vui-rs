// Pluggable syntax highlighter for `<code>` (and markdown fences). A highlighter
// turns source + language into per-line styled runs — the same `TextRun[]` the
// rest of the host already paints (via `runs.ts`), so no new styled type enters
// the system. The default impl wraps highlight.js (chosen over shiki: no WASM
// cold-start, no Web Worker — both absent in a Bun terminal); a richer engine
// (tree-sitter, shiki) can be swapped in later behind this same interface without
// touching `<code>`/`<markdown>`.
import { Attr, parseColor, type TextRun } from '@vui-rs/core'
import type { Theme } from '../theme.ts'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'

/** One highlighted line: an ordered list of styled runs (alias of `TextRun[]`). */
export type StyledLine = TextRun[]

/** A swappable syntax engine. Returns one `StyledLine` per source line. */
export interface Highlighter {
  highlight(code: string, lang?: string): StyledLine[]
}

/**
 * Color + attrs for a highlight scope. Keyed by highlight.js scope name (the part
 * after `hljs-`). Values are author-friendly color strings OR packed `0xRRGGBBAA`
 * numbers (e.g. from a `Theme`), resolved once via `parseColor`. Tuned for a dark
 * theme (Catppuccin Mocha); override via `createDefaultHighlighter`.
 */
export interface SyntaxPalette {
  [scope: string]: string | number
}

const DEFAULT_PALETTE: SyntaxPalette = {
  keyword: '#cba6f7',
  built_in: '#f38ba8',
  type: '#f9e2af',
  class: '#f9e2af',
  title: '#89b4fa',
  function: '#89b4fa',
  string: '#a6e3a1',
  char: '#a6e3a1',
  regexp: '#f5c2e7',
  number: '#fab387',
  literal: '#fab387',
  comment: '#6c7086',
  doctag: '#6c7086',
  attr: '#89dceb',
  attribute: '#89dceb',
  property: '#89dceb',
  variable: '#cdd6f4',
  params: '#eba0ac',
  meta: '#f5c2e7',
  tag: '#89b4fa',
  name: '#89b4fa',
  selector_tag: '#cba6f7',
  selector_class: '#f9e2af',
  selector_id: '#89b4fa',
  operator: '#94e2d5',
  punctuation: '#a6adc8',
  symbol: '#94e2d5',
  bullet: '#fab387',
  quote: '#6c7086',
  section: '#89b4fa',
  link: '#89b4fa',
  addition: '#a6e3a1',
  deletion: '#f38ba8',
}

/**
 * Build a syntax palette from a theme's `syntax*` tokens. Returned partial overrides
 * the built-in defaults in `createDefaultHighlighter`, so `<code>`/`<markdown>`
 * fences recolor with the active theme (and on a runtime `setTheme()`).
 */
export function syntaxPaletteFromTheme(theme: Theme): SyntaxPalette {
  return {
    keyword: theme.syntaxKeyword,
    function: theme.syntaxFunction,
    title: theme.syntaxFunction,
    name: theme.syntaxFunction,
    string: theme.syntaxString,
    char: theme.syntaxString,
    number: theme.syntaxNumber,
    literal: theme.syntaxNumber,
    type: theme.syntaxType,
    class: theme.syntaxType,
    variable: theme.syntaxVariable,
    params: theme.syntaxVariable,
    property: theme.syntaxVariable,
    operator: theme.syntaxOperator,
    symbol: theme.syntaxOperator,
    punctuation: theme.syntaxPunctuation,
    comment: theme.syntaxComment,
    doctag: theme.syntaxComment,
    quote: theme.syntaxComment,
    built_in: theme.error,
  }
}

/** Scopes rendered italic regardless of color. */
const ITALIC_SCOPES = new Set(['comment', 'doctag', 'quote'])

let registered = false
function ensureRegistered(): void {
  if (registered) return
  registered = true
  hljs.registerLanguage('typescript', typescript)
  hljs.registerLanguage('javascript', javascript)
  hljs.registerLanguage('rust', rust)
  hljs.registerLanguage('python', python)
  hljs.registerLanguage('go', go)
  hljs.registerLanguage('json', json)
  hljs.registerLanguage('bash', bash)
  hljs.registerLanguage('xml', xml)
  hljs.registerLanguage('css', css)
  // configure() turns off the (irrelevant for runs) auto-detect retry on throw.
  hljs.configure({ throwUnescapedHTML: false })
}

/** Pack a palette of color strings into resolved `0xRRGGBBAA` numbers + attrs. */
interface PackedScope {
  fg?: number
  attrs: number
}

function packPalette(palette: SyntaxPalette): Map<string, PackedScope> {
  const out = new Map<string, PackedScope>()
  for (const [scope, color] of Object.entries(palette)) {
    out.set(scope, {
      fg: parseColor(color),
      attrs: ITALIC_SCOPES.has(scope) ? Attr.ITALIC : 0,
    })
  }
  return out
}

/** Resolve a highlight.js `class="hljs-x y_"` attribute to the first known scope. */
function classToScope(classAttr: string, packed: Map<string, PackedScope>): PackedScope | undefined {
  for (const raw of classAttr.split(/\s+/)) {
    // `hljs-title function_` → scope candidates `title`, `function`.
    const name = raw.replace(/^hljs-/, '').replace(/_+$/, '')
    if (!name) continue
    const hit = packed.get(name)
    if (hit) return hit
  }
  return undefined
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  '#x27': "'",
  '#x2F': '/',
  '#47': '/',
  nbsp: ' ',
}

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body) => {
    const named = ENTITIES[body]
    if (named !== undefined) return named
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      // Guard the Unicode range — `fromCodePoint` throws outside [0, 0x10FFFF].
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return whole
  })
}

/**
 * Parse highlight.js's nested-`<span>` HTML into a flat run list, carrying the
 * top-of-stack color/attrs onto each text chunk. Newlines stay embedded in the
 * run text; the caller splits runs into lines.
 */
function htmlToRuns(html: string, packed: Map<string, PackedScope>): TextRun[] {
  const runs: TextRun[] = []
  const stack: PackedScope[] = []
  let i = 0
  while (i < html.length) {
    const ch = html[i]
    if (ch === '<') {
      const close = html.indexOf('>', i)
      if (close < 0) break
      const tag = html.slice(i + 1, close)
      if (tag[0] === '/') {
        stack.pop()
      } else {
        const m = /class="([^"]*)"/.exec(tag)
        const scope = m ? classToScope(m[1]!, packed) : undefined
        const top = stack[stack.length - 1]
        // Inherit the parent's color when this span is an unknown scope.
        stack.push({
          fg: scope?.fg ?? top?.fg,
          attrs: (scope?.attrs ?? 0) | (top?.attrs ?? 0),
        })
      }
      i = close + 1
    } else {
      let j = html.indexOf('<', i)
      if (j < 0) j = html.length
      const text = decodeEntities(html.slice(i, j))
      if (text) {
        const top = stack[stack.length - 1]
        const run: TextRun = { text }
        if (top?.fg !== undefined) run.fg = top.fg
        if (top?.attrs) run.attrs = top.attrs
        runs.push(run)
      }
      i = j
    }
  }
  return runs
}

/** Split a flat run list on embedded newlines into per-line run arrays. */
function runsToLines(runs: TextRun[]): StyledLine[] {
  const lines: StyledLine[] = [[]]
  for (const run of runs) {
    const parts = run.text.split('\n')
    for (let p = 0; p < parts.length; p++) {
      if (p > 0) lines.push([])
      const piece = parts[p]!
      if (piece) {
        const r: TextRun = { text: piece }
        if (run.fg !== undefined) r.fg = run.fg
        if (run.bg !== undefined) r.bg = run.bg
        if (run.attrs) r.attrs = run.attrs
        lines[lines.length - 1]!.push(r)
      }
    }
  }
  // A trailing newline yields a redundant empty line — drop it.
  if (lines.length > 1 && lines[lines.length - 1]!.length === 0) lines.pop()
  return lines
}

/** Each non-empty source line as a single plain run (no-highlight fallback). */
function plainLines(code: string): StyledLine[] {
  const stripped = code.endsWith('\n') ? code.slice(0, -1) : code
  return stripped.split('\n').map((line) => (line ? [{ text: line }] : []))
}

/**
 * The built-in highlighter: highlight.js over a registered set of common
 * languages (ts/js/rust/python/go/json/bash/html/css), adapted to styled runs.
 * Unknown or omitted languages fall back to uncolored lines — never throws.
 */
export function createDefaultHighlighter(palette: SyntaxPalette = DEFAULT_PALETTE): Highlighter {
  const packed = packPalette({ ...DEFAULT_PALETTE, ...palette })
  return {
    highlight(code: string, lang?: string): StyledLine[] {
      ensureRegistered()
      const language = lang ? normalizeLang(lang) : undefined
      if (!language || !hljs.getLanguage(language)) return plainLines(code)
      try {
        const html = hljs.highlight(code, { language, ignoreIllegals: true }).value
        return runsToLines(htmlToRuns(html, packed))
      } catch {
        return plainLines(code)
      }
    },
  }
}

/** Map common short language ids/extensions onto highlight.js language names. */
function normalizeLang(lang: string): string {
  const l = lang.trim().toLowerCase()
  const alias: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    rs: 'rust',
    py: 'python',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    golang: 'go',
    html: 'xml',
    htm: 'xml',
    vue: 'xml',
    yml: 'yaml',
  }
  return alias[l] ?? l
}

/** The shared default highlighter instance used by `<code>`/`<markdown>`. */
export const defaultHighlighter: Highlighter = createDefaultHighlighter()
