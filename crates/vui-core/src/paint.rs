//! Paint pass: a pre-order walk of the render-node tree that stamps each node
//! into the cell buffer at its taffy-computed rect. Order is painter's order
//! (child order == z-order for v0). Every write goes through a clip rect so a
//! child can never draw outside its parent's content box, and "transparent"
//! fills/text preserve whatever background already sits in the cell.
//!
//! User text and titles are always written as *cells* (never as escape bytes);
//! the renderer's emit path additionally maps any stored control codepoint to a
//! space, so this invariant holds even for raw buffer writes.

// The private draw helpers take an explicit (x0,y0,x1,y1) rect plus colors; the
// flat coordinate args read more clearly here than a wrapper struct would.
#![allow(clippy::too_many_arguments)]

use crate::border::{glyphs, BorderGlyphs};
use crate::buffer::{CellBuffer, DEFAULT_FG};
use crate::color::Rgba;
use crate::layout::node_box;
use crate::node::{NodeId, NodeKind, NodeTree, RenderNode, TitleAlign};
use crate::width::char_width;
use unicode_segmentation::UnicodeSegmentation;

/// A scissor rectangle in absolute cell coordinates, half-open: a cell `(x, y)`
/// is inside when `x0 <= x < x1` and `y0 <= y < y1`. Stored as `i64` so
/// off-screen (negative) origins clip correctly before any `u32` cast.
#[derive(Clone, Copy)]
struct Clip {
    x0: i64,
    y0: i64,
    x1: i64,
    y1: i64,
}

impl Clip {
    fn intersect(self, o: Clip) -> Clip {
        Clip {
            x0: self.x0.max(o.x0),
            y0: self.y0.max(o.y0),
            x1: self.x1.min(o.x1),
            y1: self.y1.min(o.y1),
        }
    }
    fn is_empty(self) -> bool {
        self.x0 >= self.x1 || self.y0 >= self.y1
    }
    fn contains(self, x: i64, y: i64) -> bool {
        x >= self.x0 && x < self.x1 && y >= self.y0 && y < self.y1
    }
}

/// Paint the whole tree into `buf`. The caller clears `buf` to the base
/// background first; this only stamps node backgrounds, borders, and text.
pub fn paint(tree: &NodeTree, buf: &mut CellBuffer) {
    let screen = Clip {
        x0: 0,
        y0: 0,
        x1: buf.width as i64,
        y1: buf.height as i64,
    };
    paint_node(tree, buf, tree.root(), 0.0, 0.0, screen);
}

fn paint_node(
    tree: &NodeTree,
    buf: &mut CellBuffer,
    id: NodeId,
    parent_x: f32,
    parent_y: f32,
    clip: Clip,
) {
    let Some(node) = tree.get(id) else { return };
    if !node.paint.is_drawable() {
        return;
    }
    let Some(b) = node_box(tree, id) else { return };

    // Absolute (unrounded) origin of this node's border box. Children are placed
    // relative to it; rounding happens per-node so flush siblings share an edge.
    let abs_x = parent_x + b.x;
    let abs_y = parent_y + b.y;
    let x0 = abs_x.round() as i64;
    let y0 = abs_y.round() as i64;
    let x1 = (abs_x + b.w).round() as i64;
    let y1 = (abs_y + b.h).round() as i64;

    let node_clip = clip.intersect(Clip { x0, y0, x1, y1 });
    if node_clip.is_empty() {
        return; // fully clipped: its children are too.
    }

    // Background fill (only when the node actually sets one — else transparent).
    if let Some(bg) = node.paint.bg {
        fill(buf, node_clip, x0, y0, x1, y1, bg);
    }

    // Border ring + optional title, drawn at the node's own edge.
    if let Some(style) = node.paint.border {
        let color = node.paint.border_color.or(node.paint.fg).unwrap_or(DEFAULT_FG);
        draw_border(buf, node_clip, x0, y0, x1, y1, glyphs(style), color, node);
        if let Some(title) = &node.paint.title {
            draw_title(buf, node_clip, x0, x1, y0, title, node);
        }
    }

    // Content box: inset by taffy's reserved border + padding on each side.
    let cx0 = x0 + round(b.border.left) + round(b.padding.left);
    let cy0 = y0 + round(b.border.top) + round(b.padding.top);
    let cx1 = x1 - round(b.border.right) - round(b.padding.right);
    let cy1 = y1 - round(b.border.bottom) - round(b.padding.bottom);
    let content_clip = node_clip.intersect(Clip {
        x0: cx0,
        y0: cy0,
        x1: cx1,
        y1: cy1,
    });

    if node.kind == NodeKind::Text
        && let Some(text) = &node.text
    {
        draw_runs(buf, content_clip, cx0, cy0, cx1, cy1, text, node);
    }

    // Children paint over this node, clipped to its content box.
    for &child in &node.children {
        paint_node(tree, buf, child, abs_x, abs_y, content_clip);
    }
}

#[inline]
fn round(v: f32) -> i64 {
    v.round() as i64
}

/// Write one cell if it falls inside the clip (the clip is already intersected
/// with the buffer, so an in-clip cell is in-bounds).
fn put(buf: &mut CellBuffer, clip: Clip, x: i64, y: i64, ch: u32, fg: Rgba, bg: Rgba, attrs: u16) {
    if clip.contains(x, y) {
        buf.set_cell(x as u32, y as u32, ch, fg, bg, attrs);
    }
}

/// Background of a node: the existing cell content is fully replaced with a
/// blank of `bg` (an opaque fill).
fn fill(buf: &mut CellBuffer, clip: Clip, x0: i64, y0: i64, x1: i64, y1: i64, bg: Rgba) {
    for y in y0..y1 {
        for x in x0..x1 {
            put(buf, clip, x, y, ' ' as u32, DEFAULT_FG, bg, 0);
        }
    }
}

/// Read the background currently in a cell, so a transparent glyph keeps it.
fn bg_under(buf: &CellBuffer, x: i64, y: i64) -> Rgba {
    if x < 0 || y < 0 {
        return crate::buffer::DEFAULT_BG;
    }
    buf.get_cell(x as u32, y as u32)
        .map(|c| c.bg)
        .unwrap_or(crate::buffer::DEFAULT_BG)
}

fn draw_border(
    buf: &mut CellBuffer,
    clip: Clip,
    x0: i64,
    y0: i64,
    x1: i64,
    y1: i64,
    g: BorderGlyphs,
    fg: Rgba,
    node: &RenderNode,
) {
    if x1 - x0 < 2 || y1 - y0 < 2 {
        return; // too small to frame
    }
    let bg = |buf: &CellBuffer, x: i64, y: i64| node.paint.bg.unwrap_or_else(|| bg_under(buf, x, y));
    let right = x1 - 1;
    let bottom = y1 - 1;
    // Horizontal runs.
    for x in (x0 + 1)..right {
        let t = bg(buf, x, y0);
        put(buf, clip, x, y0, g.horizontal as u32, fg, t, 0);
        let bch = bg(buf, x, bottom);
        put(buf, clip, x, bottom, g.horizontal as u32, fg, bch, 0);
    }
    // Vertical runs.
    for y in (y0 + 1)..bottom {
        let l = bg(buf, x0, y);
        put(buf, clip, x0, y, g.vertical as u32, fg, l, 0);
        let r = bg(buf, right, y);
        put(buf, clip, right, y, g.vertical as u32, fg, r, 0);
    }
    // Corners (background read before the mutable write to avoid aliasing buf).
    let tl = bg(buf, x0, y0);
    put(buf, clip, x0, y0, g.top_left as u32, fg, tl, 0);
    let tr = bg(buf, right, y0);
    put(buf, clip, right, y0, g.top_right as u32, fg, tr, 0);
    let bl = bg(buf, x0, bottom);
    put(buf, clip, x0, bottom, g.bottom_left as u32, fg, bl, 0);
    let br = bg(buf, right, bottom);
    put(buf, clip, right, bottom, g.bottom_right as u32, fg, br, 0);
}

/// Draw the title onto the top border row, inside the corners, aligned. The
/// title is data — painted as cells, never interpreted.
fn draw_title(
    buf: &mut CellBuffer,
    clip: Clip,
    x0: i64,
    x1: i64,
    y0: i64,
    title: &str,
    node: &RenderNode,
) {
    let inner_left = x0 + 1;
    let inner_right = x1 - 1; // exclusive
    let avail = inner_right - inner_left;
    if avail <= 0 {
        return;
    }
    let fg = node.paint.fg.unwrap_or(DEFAULT_FG);
    let title_w: i64 = title.graphemes(true).map(|g| grapheme_width(g) as i64).sum();
    let start = match node.paint.title_align {
        TitleAlign::Left => inner_left,
        TitleAlign::Right => inner_right - title_w,
        TitleAlign::Center => inner_left + (avail - title_w) / 2,
    }
    .max(inner_left);
    draw_line(buf, clip, start, inner_right, y0, title, fg, node.paint.bg);
}

/// Multi-run text flow with character/grapheme wrapping at the content width.
/// Each run uses its own fg/bg/attrs, falling back to the node's paint defaults;
/// attrs compose (node base OR run) so a `<b>` run adds bold over the node's.
fn draw_runs(
    buf: &mut CellBuffer,
    clip: Clip,
    cx0: i64,
    cy0: i64,
    cx1: i64,
    cy1: i64,
    text: &crate::node::TextContent,
    node: &RenderNode,
) {
    if cx1 <= cx0 || cy1 <= cy0 {
        return;
    }
    let mut col = cx0;
    let mut row = cy0;
    for run in &text.runs {
        let fg = run.fg.or(node.paint.fg).unwrap_or(DEFAULT_FG);
        let attrs = node.paint.attrs | run.attrs;
        for g in run.text.graphemes(true) {
            if g == "\n" {
                col = cx0;
                row += 1;
                if row >= cy1 {
                    return;
                }
                continue;
            }
            let Some(ch) = g.chars().next() else { continue };
            let w = char_width(ch).max(1) as i64;
            // Wrap when the glyph (or its wide pair) would exceed the content box.
            if col + w > cx1 {
                col = cx0;
                row += 1;
                if row >= cy1 {
                    return;
                }
            }
            if col + w > cx1 {
                continue; // glyph wider than the whole content box: skip it.
            }
            let bg = run.bg.or(node.paint.bg).unwrap_or_else(|| bg_under(buf, col, row));
            put(buf, clip, col, row, ch as u32, fg, bg, attrs);
            if w == 2 {
                put(
                    buf,
                    clip,
                    col + 1,
                    row,
                    0,
                    fg,
                    bg,
                    attrs | crate::buffer::attr::WIDE_CONTINUATION,
                );
            }
            col += w;
        }
    }
}

/// Single-line text from `start`, clipped to `[start, end)` columns on row `y`.
fn draw_line(
    buf: &mut CellBuffer,
    clip: Clip,
    start: i64,
    end: i64,
    y: i64,
    text: &str,
    fg: Rgba,
    bg: Option<Rgba>,
) {
    let mut col = start;
    for g in text.graphemes(true) {
        let Some(ch) = g.chars().next() else { continue };
        let w = char_width(ch).max(1) as i64;
        if col + w > end {
            break;
        }
        let cell_bg = bg.unwrap_or_else(|| bg_under(buf, col, y));
        put(buf, clip, col, y, ch as u32, fg, cell_bg, 0);
        if w == 2 {
            put(
                buf,
                clip,
                col + 1,
                y,
                0,
                fg,
                cell_bg,
                crate::buffer::attr::WIDE_CONTINUATION,
            );
        }
        col += w;
    }
}

fn grapheme_width(g: &str) -> usize {
    g.chars().next().map(char_width).unwrap_or(0).max(1)
}
