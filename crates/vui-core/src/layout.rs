//! Layout pass: hand the render-node tree to taffy, compute flexbox positions,
//! and read each node's box back. This is the only file besides `style.rs` that
//! touches taffy's compute/readback API, so a taffy upgrade is contained here.
//!
//! taffy reports each node's `location` relative to its parent's top-left and in
//! fractional points (== cells here). Paint accumulates those offsets into an
//! absolute origin and rounds *both* edges of a box to integer cells, so two
//! flush siblings round their shared edge identically (no 1-cell seam or
//! overlap).

use crate::node::{NodeId, NodeTree};
use taffy::geometry::Size;
use taffy::style::AvailableSpace;

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

/// Run taffy over the tree sized to `width`×`height` cells and clear the dirty
/// flag. Cheap to call every frame, but callers should gate it on
/// `NodeTree::is_dirty` so an unchanged tree skips the work.
pub fn compute(tree: &mut NodeTree, width: u32, height: u32) {
    tree.set_root_size(width, height);
    let Some(root_taffy) = tree.get(tree.root()).map(|n| n.taffy) else {
        return;
    };
    let _ = tree.taffy.compute_layout(
        root_taffy,
        Size {
            width: AvailableSpace::Definite(width as f32),
            height: AvailableSpace::Definite(height as f32),
        },
    );
    tree.clear_dirty();
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
