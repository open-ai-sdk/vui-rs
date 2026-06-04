//! Layout pass: hand the render-node tree to taffy and read each node's box back.
//! The compute itself lives on `NodeTree::compute_layout` (it needs a disjoint
//! borrow of taffy + the node slab for the text measure callback); this file owns
//! the `NodeBox` readback and, with `style.rs`, taffy's geometry types.
//!
//! taffy reports each node's `location` relative to its parent's top-left and in
//! fractional points (== cells here). Paint accumulates those offsets into an
//! absolute origin and rounds *both* edges of a box to integer cells, so two
//! flush siblings round their shared edge identically (no 1-cell seam or
//! overlap).

use crate::node::{NodeId, NodeTree};

/// Per-side lengths (cells, fractional) — padding or border insets.
#[derive(Clone, Copy, Debug, Default)]
pub struct Edges {
    pub left: f32,
    pub right: f32,
    pub top: f32,
    pub bottom: f32,
}

/// A node's taffy box: `(x, y)` relative to the parent, fractional size, plus the
/// padding and border insets taffy reserved inside it.
#[derive(Clone, Copy, Debug)]
pub struct NodeBox {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub padding: Edges,
    pub border: Edges,
}

/// Run taffy over the tree sized to `width`×`height` cells (auto-sizing `<text>`
/// from its content) and clear the dirty flag. Cheap to call every frame, but
/// callers should gate it on `NodeTree::is_dirty` so an unchanged tree skips the
/// work.
pub fn compute(tree: &mut NodeTree, width: u32, height: u32) {
    tree.compute_layout(width, height);
}

/// Read a node's computed box. `None` if the handle is stale or taffy has no
/// layout for it yet (compute not run).
pub fn node_box(tree: &NodeTree, id: NodeId) -> Option<NodeBox> {
    let taffy = tree.get(id)?.taffy;
    let l = tree.taffy.layout(taffy).ok()?;
    Some(NodeBox {
        x: l.location.x,
        y: l.location.y,
        w: l.size.width,
        h: l.size.height,
        padding: Edges {
            left: l.padding.left,
            right: l.padding.right,
            top: l.padding.top,
            bottom: l.padding.bottom,
        },
        border: Edges {
            left: l.border.left,
            right: l.border.right,
            top: l.border.top,
            bottom: l.border.bottom,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::NodeKind;
    use crate::style::{DimFfi, StyleFfi};

    /// A StyleFfi base: flex container, no constraints. Helpers below tweak it.
    fn style() -> StyleFfi {
        StyleFfi::default()
    }

    fn len(v: f32) -> DimFfi {
        DimFfi { kind: 1, value: v }
    }

    #[test]
    fn row_splits_two_grow_children_evenly() {
        // root (40x10) -> row of two flex-grow:1 children -> each 20 wide.
        let mut t = NodeTree::new(40, 10);
        let root = t.root();
        let mut row = style();
        row.width = len(40.0);
        row.height = len(10.0);
        t.set_style(root, &row);

        let mut child = style();
        child.flex_grow = 1.0;
        child.height = len(10.0);
        let a = t.create(NodeKind::Box);
        let b = t.create(NodeKind::Box);
        t.set_style(a, &child);
        t.set_style(b, &child);
        t.append_child(root, a);
        t.append_child(root, b);

        compute(&mut t, 40, 10);
        let ba = node_box(&t, a).unwrap();
        let bb = node_box(&t, b).unwrap();
        assert_eq!(ba.x.round() as i32, 0);
        assert_eq!(ba.w.round() as i32, 20);
        assert_eq!(bb.x.round() as i32, 20);
        assert_eq!(bb.w.round() as i32, 20);
    }

    #[test]
    fn flex_grow_change_relays_out() {
        let mut t = NodeTree::new(30, 5);
        let root = t.root();
        let a = t.create(NodeKind::Box);
        let b = t.create(NodeKind::Box);
        let mut one = style();
        one.flex_grow = 1.0;
        t.set_style(a, &one);
        t.set_style(b, &one);
        t.append_child(root, a);
        t.append_child(root, b);
        compute(&mut t, 30, 5);
        assert_eq!(node_box(&t, a).unwrap().w.round() as i32, 15);

        // Give `a` twice the grow: it should claim 2/3 of the width.
        let mut two = style();
        two.flex_grow = 2.0;
        t.set_style(a, &two);
        assert!(t.is_dirty());
        compute(&mut t, 30, 5);
        assert_eq!(node_box(&t, a).unwrap().w.round() as i32, 20);
    }

    use crate::node::{TextContent, TextRun};

    /// Attach a single plain run of `text` to a node.
    fn set_text(t: &mut NodeTree, id: NodeId, text: &str) {
        t.get_mut(id).unwrap().text = Some(TextContent {
            runs: vec![TextRun {
                text: text.into(),
                fg: None,
                bg: None,
                attrs: 0,
            }],
        });
    }

    /// A child of an `align-items: start` row container, so the measured size is
    /// visible on BOTH axes — the default `stretch` would otherwise fill the
    /// child's cross (height) to the container and mask the measured height.
    fn child_in_unstretched_row(t: &mut NodeTree, kind: NodeKind) -> NodeId {
        let root = t.root();
        let mut cont = style();
        cont.width = len(80.0);
        cont.height = len(24.0);
        cont.align_items = 1; // align_code::START
        t.set_style(root, &cont);
        let child = t.create(kind);
        t.append_child(root, child);
        child
    }

    #[test]
    fn unsized_text_is_content_sized() {
        // A bare <text> with no width/height measures to its content (5×1), where
        // before the measure pass it would have collapsed to 0×0.
        let mut t = NodeTree::new(80, 24);
        let txt = child_in_unstretched_row(&mut t, NodeKind::Text);
        set_text(&mut t, txt, "hello");
        compute(&mut t, 80, 24);
        let b = node_box(&t, txt).unwrap();
        assert_eq!(b.w.round() as i32, 5);
        assert_eq!(b.h.round() as i32, 1);
    }

    #[test]
    fn wrapping_text_in_fixed_width_reports_height() {
        // Explicit width 10, auto height, 25 chars => ceil(25/10) = 3 rows.
        let mut t = NodeTree::new(80, 24);
        let txt = child_in_unstretched_row(&mut t, NodeKind::Text);
        let mut s = style();
        s.width = len(10.0);
        t.set_style(txt, &s);
        set_text(&mut t, txt, "abcdefghijklmnopqrstuvwxy"); // 25 chars
        compute(&mut t, 80, 24);
        let b = node_box(&t, txt).unwrap();
        assert_eq!(b.w.round() as i32, 10, "explicit width wins");
        assert_eq!(b.h.round() as i32, 3, "height measured from wrapped lines");
    }

    #[test]
    fn explicit_dims_override_measurement() {
        // Both width and height fixed: content never overrides the author's box.
        let mut t = NodeTree::new(80, 24);
        let txt = child_in_unstretched_row(&mut t, NodeKind::Text);
        let mut s = style();
        s.width = len(4.0);
        s.height = len(2.0);
        t.set_style(txt, &s);
        set_text(
            &mut t,
            txt,
            "this is a long string that would wrap to many rows",
        );
        compute(&mut t, 80, 24);
        let b = node_box(&t, txt).unwrap();
        assert_eq!(b.w.round() as i32, 4);
        assert_eq!(b.h.round() as i32, 2);
    }

    #[test]
    fn text_change_re_measures_after_dirty() {
        let mut t = NodeTree::new(80, 24);
        let txt = child_in_unstretched_row(&mut t, NodeKind::Text);
        set_text(&mut t, txt, "hi");
        compute(&mut t, 80, 24);
        assert_eq!(node_box(&t, txt).unwrap().w.round() as i32, 2);
        // Grow the content; mark dirty so taffy re-measures (the FFI text setters
        // call this — here we drive it directly).
        set_text(&mut t, txt, "hello world");
        t.mark_text_dirty(txt);
        compute(&mut t, 80, 24);
        assert_eq!(node_box(&t, txt).unwrap().w.round() as i32, 11);
    }

    #[test]
    fn non_text_leaf_is_not_content_sized() {
        // Regression: only <text> is measured. A styleless box leaf reports zero
        // content size, so (with stretch off) it stays 0×0 — sized only by its
        // own style/flex, exactly as before the measure pass existed.
        let mut t = NodeTree::new(80, 24);
        let bx = child_in_unstretched_row(&mut t, NodeKind::Box);
        compute(&mut t, 80, 24);
        let b = node_box(&t, bx).unwrap();
        assert_eq!(b.w.round() as i32, 0);
        assert_eq!(b.h.round() as i32, 0);
    }

    #[test]
    fn padding_is_reported_for_content_inset() {
        let mut t = NodeTree::new(20, 6);
        let root = t.root();
        let a = t.create(NodeKind::Box);
        let mut s = style();
        s.width = len(20.0);
        s.height = len(6.0);
        s.padding_left = len(2.0);
        s.padding_top = len(1.0);
        t.set_style(a, &s);
        t.append_child(root, a);
        compute(&mut t, 20, 6);
        let bx = node_box(&t, a).unwrap();
        assert_eq!(bx.padding.left.round() as i32, 2);
        assert_eq!(bx.padding.top.round() as i32, 1);
    }
}
