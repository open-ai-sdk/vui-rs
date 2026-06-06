// Theme JSON loader + resolver. A theme file
// `defs` (named colors) + `theme` (semantic tokens), each token either a literal
// color, a `defs`/token reference, or a `{ dark, light }` variant. Resolving picks
// the variant for the active mode, follows references (cycle-guarded), and packs
// every color to `0xRRGGBBAA`. Theme
// files (and `~/.vui/themes/*.json`) load here unchanged.
import { parseColor } from '@vui-rs/core'
import type { Theme } from '../theme.ts'

/** A literal color (`#rrggbb(aa)`, `rgb()/rgba()`, named) or a `defs`/token ref. */
export type ColorValue = string | number | { dark: string | number; light: string | number }

/** The on-disk theme shape. */
export interface ThemeJson {
  $schema?: string
  /** Named color palette; token values may reference these by name. */
  defs?: Record<string, string | number>
  /** Semantic tokens; keys are theme token names. */
  theme: Record<string, ColorValue>
}

const TRANSPARENT = 0x00000000

/** Resolve one `ColorValue` to a packed `0xRRGGBBAA`, following `defs`/token refs. */
function resolveColor(value: ColorValue, json: ThemeJson, mode: 'dark' | 'light', chain: string[] = []): number {
  if (typeof value === 'number') return value >>> 0
  if (typeof value === 'string') {
    if (value === 'transparent' || value === 'none') return TRANSPARENT
    if (value.startsWith('#') || value.startsWith('rgb')) {
      return parseColor(value) ?? TRANSPARENT
    }
    // A bare name references a `defs` entry or another theme token.
    if (chain.includes(value)) {
      throw new Error(`vui theme: circular color reference: ${[...chain, value].join(' -> ')}`)
    }
    const next = json.defs?.[value] ?? json.theme[value]
    if (next === undefined) {
      const named = parseColor(value)
      if (named !== undefined) return named
      throw new Error(`vui theme: color reference "${value}" not found in defs or theme`)
    }
    return resolveColor(next, json, mode, [...chain, value])
  }
  // A `{ dark, light }` variant — anything else is a malformed token value.
  if (value && typeof value === 'object' && 'dark' in value && 'light' in value) {
    return resolveColor(value[mode], json, mode, chain)
  }
  throw new Error(`vui theme: invalid color value: ${JSON.stringify(value)}`)
}

/**
 * Resolve a theme JSON into a fully packed `Theme` for the given mode. Every token
 * falls back to a sensible related token when omitted (so partial/older theme
 * files still load), and the legacy `fg`/`bg`/`muted` aliases mirror
 * `text`/`background`/`textMuted` for backward compatibility.
 */
export function resolveThemeJson(json: ThemeJson, mode: 'dark' | 'light' = 'dark'): Theme {
  const r: Record<string, number> = {}
  for (const [key, value] of Object.entries(json.theme)) {
    r[key] = resolveColor(value, json, mode)
  }
  const at = (key: string, fallback: number): number => r[key] ?? fallback

  const text = at('text', 0xcdd6f4ff)
  const background = at('background', 0x1e1e2eff)
  const textMuted = at('textMuted', text)
  // The highlight color: `primary`. The legacy `accent` token keeps its
  // historical meaning (the one highlight color) and maps to `primary`.
  const primary = at('primary', text)
  const backgroundElement = at('backgroundElement', background)
  const border = at('border', textMuted)
  const diffAdded = at('diffAdded', 0xa6e3a1ff)
  const diffRemoved = at('diffRemoved', 0xf38ba8ff)

  return {
    primary,
    secondary: at('secondary', primary),
    accent: primary,
    error: at('error', diffRemoved),
    warning: at('warning', 0xf9e2afff),
    success: at('success', diffAdded),
    info: at('info', primary),
    text,
    textMuted,
    selectedText: at('selectedListItemText', background),
    background,
    backgroundPanel: at('backgroundPanel', background),
    backgroundElement,
    backgroundMenu: at('backgroundMenu', backgroundElement),
    border,
    borderActive: at('borderActive', border),
    borderSubtle: at('borderSubtle', border),
    diffAdded,
    diffRemoved,
    diffContext: at('diffContext', textMuted),
    diffHunkHeader: at('diffHunkHeader', primary),
    diffAddedBg: at('diffAddedBg', background),
    diffRemovedBg: at('diffRemovedBg', background),
    diffContextBg: at('diffContextBg', background),
    markdownText: at('markdownText', text),
    markdownHeading: at('markdownHeading', primary),
    markdownLink: at('markdownLink', primary),
    markdownLinkText: at('markdownLinkText', primary),
    markdownCode: at('markdownCode', diffAdded),
    markdownBlockQuote: at('markdownBlockQuote', textMuted),
    markdownEmph: at('markdownEmph', text),
    markdownStrong: at('markdownStrong', text),
    markdownHorizontalRule: at('markdownHorizontalRule', textMuted),
    markdownListItem: at('markdownListItem', primary),
    markdownListEnumeration: at('markdownListEnumeration', primary),
    markdownImage: at('markdownImage', primary),
    markdownImageText: at('markdownImageText', primary),
    markdownCodeBlock: at('markdownCodeBlock', text),
    syntaxComment: at('syntaxComment', textMuted),
    syntaxKeyword: at('syntaxKeyword', primary),
    syntaxFunction: at('syntaxFunction', primary),
    syntaxVariable: at('syntaxVariable', text),
    syntaxString: at('syntaxString', diffAdded),
    syntaxNumber: at('syntaxNumber', 0xfab387ff),
    syntaxType: at('syntaxType', 0xf9e2afff),
    syntaxOperator: at('syntaxOperator', primary),
    syntaxPunctuation: at('syntaxPunctuation', text),
    // Legacy aliases (backward compatibility).
    fg: text,
    bg: background,
    muted: textMuted,
  }
}

/** Read + parse a theme JSON file from disk (`~/.vui/themes/*.json`). */
export async function loadThemeFile(path: string): Promise<ThemeJson> {
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(path, 'utf8')
  const json = JSON.parse(raw) as ThemeJson
  if (typeof json !== 'object' || json === null || typeof json.theme !== 'object') {
    throw new Error(`vui theme: "${path}" is not a valid theme file (missing "theme")`)
  }
  return json
}
