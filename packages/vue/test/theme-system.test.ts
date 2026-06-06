// Theme-system tests: the JSON loader/resolver (refs, dark/light variants,
// fallbacks, legacy aliases), the built-in registry, contrast helpers, and the
// runtime `setTheme()` switch — a default `<text>` recolors after a swap, with no
// remount, proving the live-theme paint fallback works.
import { describe, expect, test } from 'bun:test'
import { Renderer } from '@vui-rs/core'
import {
  type ThemeJson,
  createApp,
  darkTheme,
  defineComponent,
  h,
  isLight,
  lightTheme,
  listThemes,
  luminance,
  parseColor,
  pickForeground,
  resolveTheme,
  resolveThemeJson,
  useSetTheme,
} from '../src/index.ts'
import { channels, firstGlyphFg } from './helpers/read-buffer.ts'

const RED = parseColor('#ff0000')!

const SAMPLE: ThemeJson = {
  defs: { ink: '#101010', paper: '#fafafa', blue: '#0000ff' },
  theme: {
    primary: { dark: 'blue', light: 'blue' },
    text: { dark: 'paper', light: 'ink' },
    background: { dark: 'ink', light: 'paper' },
    error: '#ff0000',
  },
}

describe('theme loader', () => {
  test('resolves defs references and picks the dark/light variant', () => {
    const dark = resolveThemeJson(SAMPLE, 'dark')
    expect(dark.text).toBe(parseColor('#fafafa')!)
    expect(dark.background).toBe(parseColor('#101010')!)
    expect(dark.primary).toBe(parseColor('#0000ff')!)

    const light = resolveThemeJson(SAMPLE, 'light')
    expect(light.text).toBe(parseColor('#101010')!)
    expect(light.background).toBe(parseColor('#fafafa')!)
  })

  test('legacy aliases mirror text/background/textMuted; accent maps to primary', () => {
    const t = resolveThemeJson(SAMPLE, 'dark')
    expect(t.fg).toBe(t.text)
    expect(t.bg).toBe(t.background)
    expect(t.muted).toBe(t.textMuted)
    expect(t.accent).toBe(t.primary)
  })

  test('omitted tokens fall back to a related token', () => {
    const t = resolveThemeJson(SAMPLE, 'dark')
    // No textMuted defined → falls back to text.
    expect(t.textMuted).toBe(t.text)
    // No selectedListItemText → falls back to background.
    expect(t.selectedText).toBe(t.background)
    // No border defined → falls back to textMuted.
    expect(t.border).toBe(t.textMuted)
  })

  test('transparent / none resolve to a fully transparent color', () => {
    const t = resolveThemeJson({ theme: { text: '#ffffff', background: 'transparent', primary: 'none' } }, 'dark')
    expect(t.background).toBe(0x00000000)
    expect(t.primary).toBe(0x00000000)
  })

  test('a circular color reference throws', () => {
    const bad: ThemeJson = { defs: { a: 'b', b: 'a' }, theme: { text: 'a' } }
    expect(() => resolveThemeJson(bad, 'dark')).toThrow(/circular/i)
  })
})

describe('theme registry', () => {
  test('ships at least five built-in themes', () => {
    expect(listThemes().length).toBeGreaterThanOrEqual(5)
    expect(listThemes()).toContain('catppuccin')
  })

  test('resolveTheme picks the requested mode', () => {
    const dark = resolveTheme('catppuccin', 'dark')
    const light = resolveTheme('catppuccin', 'light')
    expect(dark.background).not.toBe(light.background)
    expect(isLight(light.background)).toBe(true)
    expect(isLight(dark.background)).toBe(false)
  })

  test('default dark/light themes are the resolved Catppuccin variants', () => {
    expect(darkTheme.background).toBe(resolveTheme('catppuccin', 'dark').background)
    expect(lightTheme.background).toBe(resolveTheme('catppuccin', 'light').background)
  })

  test('an unknown theme name throws', () => {
    expect(() => resolveTheme('does-not-exist')).toThrow(/unknown theme/i)
  })
})

describe('contrast helpers', () => {
  test('luminance ranks white above black', () => {
    expect(luminance(0xffffffff)).toBeGreaterThan(luminance(0x000000ff))
    expect(luminance(0xffffffff)).toBeCloseTo(1, 5)
    expect(luminance(0x000000ff)).toBeCloseTo(0, 5)
  })

  test('pickForeground returns dark on light bg and light on dark bg', () => {
    expect(pickForeground(0xffffffff)).toBe(0x000000ff)
    expect(pickForeground(0x000000ff)).toBe(0xffffffff)
    expect(pickForeground(0xffffffff, { dark: RED })).toBe(RED)
  })
})

describe('runtime setTheme', () => {
  test('app.setTheme recolors a default <text> without remount', () => {
    const App = defineComponent({
      setup: () => () => h('text', { width: 1, height: 1 }, 'A'),
    })
    const r = new Renderer(10, 3)
    const app = createApp(App).mount({ renderer: r, altScreen: false })
    expect(firstGlyphFg(r)).toEqual(channels(darkTheme.fg))

    app.setTheme({ fg: RED })
    app.context.flushNow()
    expect(firstGlyphFg(r)).toEqual({ r: 255, g: 0, b: 0, a: 255 })

    app.unmount()
    r.free()
  })

  test('app.setTheme by name swaps the whole palette and root canvas', () => {
    const App = defineComponent({
      setup: () => () => h('text', { width: 1, height: 1 }, 'A'),
    })
    const r = new Renderer(10, 3)
    const app = createApp(App).mount({ renderer: r, altScreen: false })

    app.setTheme('gruvbox', 'dark')
    app.context.flushNow()
    const gruvbox = resolveTheme('gruvbox', 'dark')
    expect(app.context.theme.fg).toBe(gruvbox.fg)
    expect(app.context.root!.paint.bg).toBe(gruvbox.bg)
    expect(firstGlyphFg(r)).toEqual(channels(gruvbox.fg))

    app.unmount()
    r.free()
  })

  test('useSetTheme switches from inside a component', () => {
    let swap: ((name: string) => void) | undefined
    const App = defineComponent({
      setup() {
        const setTheme = useSetTheme()
        swap = (name) => setTheme(name, 'dark')
        return () => h('text', { width: 1, height: 1 }, 'A')
      },
    })
    const r = new Renderer(10, 3)
    const app = createApp(App).mount({ renderer: r, altScreen: false })

    swap!('nord')
    app.context.flushNow()
    expect(firstGlyphFg(r)).toEqual(channels(resolveTheme('nord', 'dark').fg))

    app.unmount()
    r.free()
  })
})
