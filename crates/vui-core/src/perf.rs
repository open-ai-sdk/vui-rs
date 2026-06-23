//! Opt-in render-phase timing, gated entirely behind the `VUI_PERF` env var so
//! it is zero-cost when off: the gate is read once into a `OnceLock<bool>`, and
//! every recorder bails on the first `enabled()` check before touching the
//! accumulator. Nothing here changes render output — it only times the existing
//! phases and prints an aggregate to **stderr** (stdout is owned by the renderer).
//!
//! The accumulator is a per-thread struct (the renderer drives one thread) that
//! folds the four native phases — layout compute, the taffy measure callback
//! (with call count, which settles whether measure fires O(changed) or O(all)
//! leaves), the paint compose/diff, and the stdout emit — and flushes one
//! greppable `vui-perf` line every `FLUSH_EVERY` frames. Lines are prefixed
//! `vui-perf` so a host app's own perf logs can be grepped apart from these.

use std::cell::RefCell;
use std::sync::OnceLock;
use std::time::Duration;

static ENABLED: OnceLock<bool> = OnceLock::new();

/// Whether `VUI_PERF` is set in the environment. Read once and cached; the value
/// is fixed for the process lifetime (an env-gated opt-in, like most perf probes).
#[inline]
pub fn enabled() -> bool {
    *ENABLED.get_or_init(|| std::env::var_os("VUI_PERF").is_some())
}

/// One flush window's folded phase timings. `frames` is bumped once per paint
/// (the per-frame anchor); layout is sampled separately because the JS host
/// dirty-gates the layout pass, so some frames paint without a fresh compute.
#[derive(Default)]
struct Accum {
    frames: u32,
    layout_samples: u32,
    layout_total: Duration,
    layout_max: Duration,
    measure_calls: u64,
    measure_total: Duration,
    paint_total: Duration,
    paint_max: Duration,
    emit_total: Duration,
    emit_bytes: u64,
}

thread_local! {
    static ACCUM: RefCell<Accum> = RefCell::new(Accum::default());
}

/// Emit an aggregate line every this many painted frames.
const FLUSH_EVERY: u32 = 30;

/// Fold one layout pass: total `compute_layout` time, how many times the taffy
/// measure closure fired, and the time spent inside it. Call count is the key
/// number — it proves whether measure scales with changed leaves or all leaves.
pub fn record_layout(total: Duration, measure_calls: u64, measure_total: Duration) {
    if !enabled() {
        return;
    }
    ACCUM.with(|a| {
        let mut a = a.borrow_mut();
        a.layout_samples += 1;
        a.layout_total += total;
        if total > a.layout_max {
            a.layout_max = total;
        }
        a.measure_calls += measure_calls;
        a.measure_total += measure_total;
    });
}

/// Fold one paint+emit: `paint` is the compose/diff/ANSI-byte build, `emit` is
/// the stdout write+flush (the slow/SSH-terminal cost). This is the per-frame
/// anchor — it bumps the frame counter and flushes the window when full.
pub fn record_paint(paint: Duration, emit: Duration, emit_bytes: usize) {
    if !enabled() {
        return;
    }
    ACCUM.with(|a| {
        let mut a = a.borrow_mut();
        a.frames += 1;
        a.paint_total += paint;
        if paint > a.paint_max {
            a.paint_max = paint;
        }
        a.emit_total += emit;
        a.emit_bytes += emit_bytes as u64;
        if a.frames >= FLUSH_EVERY {
            emit_line(&a);
            *a = Accum::default();
        }
    });
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn emit_line(a: &Accum) {
    let frames = a.frames.max(1) as f64;
    let layout_n = a.layout_samples.max(1) as f64;
    // measure_calls/measure are normalized per LAYOUT PASS (they only fire on a
    // pass), everything else per FRAME — hence the `_per_pass` suffix + the
    // explicit `layout_passes` count, so the two denominators can't be confused.
    eprintln!(
        "vui-perf frames={} layout_avg={:.3}ms layout_max={:.3}ms \
measure_calls_per_pass={:.1} measure_per_pass={:.3}ms paint_avg={:.3}ms paint_max={:.3}ms \
emit_avg={:.3}ms emit_bytes_avg={:.0} layout_passes={}",
        a.frames,
        ms(a.layout_total) / layout_n,
        ms(a.layout_max),
        a.measure_calls as f64 / layout_n,
        ms(a.measure_total) / layout_n,
        ms(a.paint_total) / frames,
        ms(a.paint_max),
        ms(a.emit_total) / frames,
        a.emit_bytes as f64 / frames,
        a.layout_samples,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ms_converts_duration() {
        assert!((ms(Duration::from_millis(5)) - 5.0).abs() < 1e-9);
    }

    #[test]
    fn recorders_are_noop_when_disabled() {
        // VUI_PERF is unset in the test process, so these must not panic or
        // accumulate (they bail on the gate before touching the thread-local).
        assert!(!enabled());
        record_layout(Duration::from_millis(1), 3, Duration::from_micros(10));
        record_paint(Duration::from_millis(1), Duration::from_micros(5), 128);
        ACCUM.with(|a| assert_eq!(a.borrow().frames, 0));
    }
}
