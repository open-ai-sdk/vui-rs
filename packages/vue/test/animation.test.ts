import { describe, expect, test } from 'bun:test'
import { Renderer } from '@vui-rs/core'
import { createHostApp } from '../src/host/create-host-app.ts'
import { easings, resolveEasing } from '../src/host/animation/easing.ts'
import { createAnimation, createAnimationRegistry } from '../src/host/animation/timeline.ts'
import { useTimeline } from '../src/host/animation/use-timeline.ts'
import { VuiSpinner } from '../src/components/spinner.ts'
import { defineComponent, h, nextTick, ref } from '../src/index.ts'
import { cellGlyph, rowGlyphs } from './helpers/read-buffer.ts'

function mount(w: number, hgt: number, render: () => unknown) {
  const r = new Renderer(w, hgt)
  const App = defineComponent({ setup: () => render })
  const app = createHostApp(App).mount({ renderer: r })
  return {
    app,
    renderer: r,
    cleanup: () => {
      app.unmount()
      r.free()
    },
  }
}

describe('easing', () => {
  test('every curve maps the endpoints to 0 and 1', () => {
    for (const [name, fn] of Object.entries(easings)) {
      expect(fn(0)).toBeCloseTo(0, 5)
      expect(fn(1)).toBeCloseTo(1, 5)
    }
  })

  test('linear is the identity; inOutQuad is symmetric about 0.5', () => {
    expect(easings.linear(0.42)).toBeCloseTo(0.42, 5)
    expect(easings.inOutQuad(0.5)).toBeCloseTo(0.5, 5)
    expect(easings.inQuad(0.5)).toBeCloseTo(0.25, 5)
    expect(easings.outQuad(0.5)).toBeCloseTo(0.75, 5)
  })

  test('resolveEasing accepts names, custom fns, and falls back to linear', () => {
    expect(resolveEasing('outCubic')).toBe(easings.outCubic)
    const custom = (t: number) => t * 2
    expect(resolveEasing(custom)).toBe(custom)
    expect(resolveEasing(undefined)(0.3)).toBeCloseTo(0.3, 5)
    // Unknown name → linear.
    expect(resolveEasing('nope' as never)(0.3)).toBeCloseTo(0.3, 5)
  })
})

describe('createAnimation', () => {
  test('tweens from→to over the duration with linear easing', () => {
    const seen: number[] = []
    const a = createAnimation({
      from: 0,
      to: 100,
      duration: 100,
      onUpdate: (v) => seen.push(v),
    })
    a.tick(25)
    a.tick(25)
    expect(seen.at(-1)).toBeCloseTo(50, 5)
    a.tick(50)
    expect(seen.at(-1)).toBeCloseTo(100, 5)
    expect(a.done).toBe(true)
  })

  test('fires onComplete exactly once and clamps past the end', () => {
    let completes = 0
    const a = createAnimation({
      from: 0,
      to: 10,
      duration: 50,
      onUpdate: () => {},
      onComplete: () => completes++,
    })
    a.tick(40)
    expect(a.done).toBe(false)
    a.tick(40) // overshoots the end
    expect(a.value).toBeCloseTo(10, 5)
    expect(a.done).toBe(true)
    a.tick(40) // ignored once done
    expect(completes).toBe(1)
  })

  test('delay holds at `from` until consumed', () => {
    const seen: number[] = []
    const a = createAnimation({
      from: 5,
      to: 15,
      duration: 100,
      delay: 50,
      onUpdate: (v) => seen.push(v),
    })
    a.tick(30) // still inside the delay → no emit
    expect(seen).toHaveLength(0)
    a.tick(20) // delay consumed → emits the start value once (t=0)
    expect(seen.at(-1)).toBeCloseTo(5, 5)
    a.tick(50) // halfway through the tween
    expect(seen.at(-1)).toBeCloseTo(10, 5)
  })

  test('loop count repeats then completes', () => {
    let completes = 0
    const a = createAnimation({
      from: 0,
      to: 1,
      duration: 10,
      loop: 2,
      onUpdate: () => {},
      onComplete: () => completes++,
    })
    a.tick(10) // end of loop 1 → carries, not done
    expect(a.done).toBe(false)
    a.tick(10) // end of loop 2 → done
    expect(a.done).toBe(true)
    expect(completes).toBe(1)
  })

  test('alternate ping-pongs direction each loop', () => {
    const a = createAnimation({
      from: 0,
      to: 10,
      duration: 10,
      loop: true,
      alternate: true,
      onUpdate: () => {},
    })
    a.tick(5) // first (forward) loop, halfway → 5
    expect(a.value).toBeCloseTo(5, 5)
    a.tick(5) // boundary, carries into reversed loop at t≈0 → near 10
    a.tick(5) // reversed loop halfway → back to 5
    expect(a.value).toBeCloseTo(5, 5)
  })

  test('pause freezes, resume continues, cancel is silent', () => {
    let completes = 0
    const a = createAnimation({
      from: 0,
      to: 100,
      duration: 100,
      onUpdate: () => {},
      onComplete: () => completes++,
    })
    a.tick(25)
    a.pause()
    a.tick(50) // ignored while paused
    expect(a.value).toBeCloseTo(25, 5)
    a.resume()
    a.tick(25)
    expect(a.value).toBeCloseTo(50, 5)
    a.cancel()
    expect(a.done).toBe(true)
    a.tick(100)
    expect(completes).toBe(0) // cancel never completes
  })

  test('zero-duration tween lands on `to` immediately', () => {
    const a = createAnimation({ from: 2, to: 9, duration: 0, onUpdate: () => {} })
    a.tick(16)
    expect(a.value).toBeCloseTo(9, 5)
    expect(a.done).toBe(true)
  })

  test('restart rewinds the tween', () => {
    const a = createAnimation({ from: 0, to: 10, duration: 10, onUpdate: () => {} })
    a.tick(10)
    expect(a.done).toBe(true)
    a.restart()
    expect(a.done).toBe(false)
    a.tick(5)
    expect(a.value).toBeCloseTo(5, 5)
  })
})

describe('AnimationRegistry', () => {
  test('reports the empty↔non-empty edge and prunes finished tweens', () => {
    const edges: boolean[] = []
    const reg = createAnimationRegistry((active) => edges.push(active))
    const a = createAnimation({ from: 0, to: 1, duration: 10, onUpdate: () => {} })
    reg.add(a)
    expect(edges).toEqual([true])
    expect(reg.size).toBe(1)
    reg.tick(10) // finishes a → registry empties
    expect(reg.size).toBe(0)
    expect(edges).toEqual([true, false])
  })

  test('remove drops a live tween and fires the idle edge', () => {
    const edges: boolean[] = []
    const reg = createAnimationRegistry((active) => edges.push(active))
    const a = createAnimation({ from: 0, to: 1, duration: 100, onUpdate: () => {} })
    reg.add(a)
    reg.remove(a)
    expect(reg.size).toBe(0)
    expect(edges).toEqual([true, false])
  })
})

describe('useTimeline + scheduler integration', () => {
  test('an animated ref repaints through the existing render path', async () => {
    const value = ref(0)
    let registrySize = 0
    const App = defineComponent({
      setup() {
        const timeline = useTimeline()
        timeline.animate({
          from: 0,
          to: 9,
          duration: 90,
          easing: 'linear',
          onUpdate: (v) => {
            value.value = Math.floor(v)
          },
        })
        return () => h('text', { width: 3, height: 1 }, String(value.value))
      },
    })
    const r = new Renderer(3, 1)
    const app = createHostApp(App).mount({ renderer: r })
    registrySize = app.context.animations.size
    expect(registrySize).toBe(1)

    // Drive frames deterministically (no reliance on the real setInterval).
    app.context.animations.tick(45)
    await nextTick()
    app.context.flushNow()
    expect(cellGlyph(r, 0, 0)).toBe('4')

    app.context.animations.tick(45) // finishes
    await nextTick()
    app.context.flushNow()
    expect(cellGlyph(r, 0, 0)).toBe('9')
    expect(app.context.animations.size).toBe(0) // back to idle

    app.unmount()
    r.free()
  })

  test('cancelling a handle retires it from the registry immediately', async () => {
    let handle: ReturnType<ReturnType<typeof useTimeline>['animate']> | null = null
    const App = defineComponent({
      setup() {
        const timeline = useTimeline()
        handle = timeline.animate({ from: 0, to: 1, duration: 9999, onUpdate: () => {} })
        return () => h('text', {}, 'x')
      },
    })
    const r = new Renderer(4, 1)
    const app = createHostApp(App).mount({ renderer: r })
    expect(app.context.animations.size).toBe(1)
    handle!.cancel() // no tick needed
    expect(app.context.animations.size).toBe(0)
    app.unmount()
    r.free()
  })

  test("unmount cancels the component's animations (no leaked loop)", async () => {
    const show = ref(true)
    const App = defineComponent({
      setup() {
        const Child = defineComponent({
          setup() {
            const timeline = useTimeline()
            timeline.animate({ from: 0, to: 1, duration: 10_000, onUpdate: () => {} })
            return () => h('text', {}, 'x')
          },
        })
        return () => (show.value ? h(Child) : h('text', {}, '-'))
      },
    })
    const r = new Renderer(4, 1)
    const app = createHostApp(App).mount({ renderer: r })
    expect(app.context.animations.size).toBe(1)

    show.value = false
    await nextTick()
    app.context.flushNow()
    expect(app.context.animations.size).toBe(0) // child unmount cancelled it

    app.unmount()
    r.free()
  })
})

describe('VuiSpinner on the animation engine', () => {
  test('renders a frame and advances as the engine ticks', async () => {
    const r = new Renderer(6, 1)
    const App = defineComponent({
      setup: () => () => h(VuiSpinner, { preset: 'line', interval: 10 }),
    })
    const app = createHostApp(App).mount({ renderer: r })
    await nextTick()
    app.context.flushNow()
    const first = rowGlyphs(r, 0).trim()
    expect(first.length).toBeGreaterThan(0)
    expect(app.context.animations.size).toBe(1)

    // Advance well past one frame; the floored index must move.
    app.context.animations.tick(15)
    await nextTick()
    app.context.flushNow()
    const second = rowGlyphs(r, 0).trim()
    expect(second).not.toBe(first)

    app.unmount()
    expect(app.context.animations.size).toBe(0) // spinner stops cleanly
    r.free()
  })
})
