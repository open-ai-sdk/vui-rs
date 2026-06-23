//! The render-node tree: a layout-only mirror the JS host drives over FFI. Each
//! `RenderNode` owns a taffy layout node + (for `<text>`) the runs used to
//! measure it; painting lives entirely in the JS host. The tree is a generational
//! slab so a `NodeId` handed across FFI is stable and a stale id (freed-then-reused
//! slot) is detected by a generation mismatch rather than silently aliasing.
//!
//! Tree ops keep the taffy parent/child graph in lockstep with our own
//! `children` vectors, and any structural or layout-style change marks the tree
//! dirty so `layout::compute` only re-runs when something actually moved.

use crate::color::Rgba;
use crate::style::StyleFfi;
use crate::text::{StyledRun, TextBuffer, TextBufferView, WrapMode};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use taffy::geometry::Size;
use taffy::style::{AvailableSpace, Dimension, Style};
use taffy::{NodeId as TaffyId, TaffyTree};

/// Stable handle into the slab. Packs an index (low 24 bits) and a generation
/// (high 8 bits); `0` is never a live node, so FFI can use it as a null/error
/// sentinel. Generations start at 1 and skip 0 on wrap.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub struct NodeId(pub u32);

impl NodeId {
    const INDEX_MASK: u32 = (1 << 24) - 1;
    pub const NULL: NodeId = NodeId(0);

    fn new(index: u32, generation: u32) -> Self {
        NodeId((generation << 24) | (index & Self::INDEX_MASK))
    }
    fn index(self) -> usize {
        (self.0 & Self::INDEX_MASK) as usize
    }
    fn generation(self) -> u32 {
        self.0 >> 24
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NodeKind {
    Root,
    Box,
    Text,
    /// A single-line editable input owning an `EditBuffer`.
    Edit,
}

impl NodeKind {
    /// FFI node-kind codes. Root is created implicitly by the tree, never via
    /// `vui_node_new`, so it has no inbound code; an unknown code falls back to
    /// `Box` (the safe, most-permissive container).
    pub fn from_u8(v: u8) -> Self {
        match v {
            2 => NodeKind::Text,
            3 => NodeKind::Edit,
            _ => NodeKind::Box,
        }
    }
    pub fn code(self) -> u8 {
        match self {
            NodeKind::Root => 0,
            NodeKind::Box => 1,
            NodeKind::Text => 2,
            NodeKind::Edit => 3,
        }
    }
}

/// One styled span of text. A plain `<text>Hello</text>` is a single run; a rich
/// `<text>plain <b>bold</b></text>` is several. `fg`/`bg` `None` fall back to the
/// owning node's paint defaults at draw time.
#[derive(Clone, Debug)]
pub struct TextRun {
    pub text: String,
    pub fg: Option<Rgba>,
    pub bg: Option<Rgba>,
    pub attrs: u16,
}

#[derive(Clone, Debug, Default)]
pub struct TextContent {
    pub runs: Vec<TextRun>,
}

pub struct RenderNode {
    pub kind: NodeKind,
    pub taffy: TaffyId,
    pub parent: Option<NodeId>,
    pub children: Vec<NodeId>,
    pub text: Option<TextContent>,
    /// Text flow mode (`<text>` only) — drives the measure wrap budget.
    pub wrap: WrapMode,
    /// Monotonic stamp bumped (via `mark_text_dirty`) whenever this node's runs or
    /// wrap change — i.e. whenever its measured size could differ. The measure
    /// cache keys on it so an unchanged `<text>` is never re-wrapped, even when a
    /// distant dirty node forces taffy to re-run layout over the whole tree.
    measure_version: u64,
}

struct Slot {
    node: Option<RenderNode>,
    generation: u32,
}

/// Cached `measure_node` output for one taffy node: the wrap results for each
/// probed budget (min/max/definite), valid while `version` matches the node's
/// `measure_version`. A stale version (content changed, or the taffy id was reused
/// for a different node) misses and recomputes. `budgets`/`sizes` are tiny (≤3).
#[derive(Default)]
struct MeasureCacheEntry {
    version: u64,
    budgets: Vec<u32>,
    sizes: Vec<Size<f32>>,
}

pub struct NodeTree {
    slots: Vec<Slot>,
    free: Vec<u32>,
    pub taffy: TaffyTree,
    root: NodeId,
    dirty: bool,
    /// Source of `measure_version` stamps; bumped on every `mark_text_dirty`.
    version_counter: u64,
    /// Per-taffy-node memo of wrap results, keyed/validated by `measure_version`.
    measure_cache: HashMap<TaffyId, MeasureCacheEntry>,
}

impl NodeTree {
    pub fn new(width: u32, height: u32) -> Self {
        let mut taffy = TaffyTree::new();
        let taffy_root = taffy
            .new_leaf(root_style(width, height))
            .expect("taffy root leaf");
        let mut tree = Self {
            slots: Vec::new(),
            free: Vec::new(),
            taffy,
            root: NodeId::NULL,
            dirty: true,
            version_counter: 0,
            measure_cache: HashMap::new(),
        };
        tree.root = tree.alloc(RenderNode {
            kind: NodeKind::Root,
            taffy: taffy_root,
            parent: None,
            children: Vec::new(),
            text: None,
            wrap: WrapMode::Word,
            measure_version: 0,
        });
        tree
    }

    pub fn root(&self) -> NodeId {
        self.root
    }
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }
    pub fn clear_dirty(&mut self) {
        self.dirty = false;
    }
    pub fn taffy_node_count(&self) -> usize {
        self.taffy.total_node_count()
    }

    fn alloc(&mut self, node: RenderNode) -> NodeId {
        if let Some(index) = self.free.pop() {
            let slot = &mut self.slots[index as usize];
            slot.node = Some(node);
            NodeId::new(index, slot.generation)
        } else {
            let index = self.slots.len() as u32;
            self.slots.push(Slot {
                node: Some(node),
                generation: 1,
            });
            NodeId::new(index, 1)
        }
    }

    /// Resolve a handle, validating its generation. A stale id (slot was freed
    /// and possibly reused) returns `None` instead of aliasing another node.
    pub fn get(&self, id: NodeId) -> Option<&RenderNode> {
        let slot = self.slots.get(id.index())?;
        if slot.generation != id.generation() {
            return None;
        }
        slot.node.as_ref()
    }

    pub fn get_mut(&mut self, id: NodeId) -> Option<&mut RenderNode> {
        let slot = self.slots.get_mut(id.index())?;
        if slot.generation != id.generation() {
            return None;
        }
        slot.node.as_mut()
    }

    fn taffy_of(&self, id: NodeId) -> Option<TaffyId> {
        self.get(id).map(|n| n.taffy)
    }

    /// Create a detached node (no parent yet) of `kind` with a default taffy
    /// style. Returns the new handle, or `NULL` if the taffy allocation fails.
    pub fn create(&mut self, kind: NodeKind) -> NodeId {
        let Ok(taffy) = self.taffy.new_leaf(Style::default()) else {
            return NodeId::NULL;
        };
        let text = if kind == NodeKind::Text {
            Some(TextContent::default())
        } else {
            None
        };
        self.dirty = true;
        self.alloc(RenderNode {
            kind,
            taffy,
            parent: None,
            children: Vec::new(),
            text,
            wrap: WrapMode::Word,
            measure_version: 0,
        })
    }

    /// Detach `child` from its current parent (if any), keeping the node alive
    /// for possible re-insertion. Syncs the taffy graph.
    fn detach(&mut self, child: NodeId) {
        let Some(parent) = self.get(child).and_then(|n| n.parent) else {
            return;
        };
        if let (Some(pt), Some(ct)) = (self.taffy_of(parent), self.taffy_of(child)) {
            let _ = self.taffy.remove_child(pt, ct);
        }
        if let Some(p) = self.get_mut(parent) {
            p.children.retain(|&c| c != child);
        }
        if let Some(c) = self.get_mut(child) {
            c.parent = None;
        }
    }

    /// Append `child` to the end of `parent`'s children. A no-op (returns false)
    /// on stale ids. Re-parents `child` if it was attached elsewhere.
    pub fn append_child(&mut self, parent: NodeId, child: NodeId) -> bool {
        if self.get(parent).is_none() || self.get(child).is_none() || parent == child {
            return false;
        }
        self.detach(child);
        let (pt, ct) = (
            self.taffy_of(parent).unwrap(),
            self.taffy_of(child).unwrap(),
        );
        if self.taffy.add_child(pt, ct).is_err() {
            return false;
        }
        self.get_mut(parent).unwrap().children.push(child);
        self.get_mut(child).unwrap().parent = Some(parent);
        self.dirty = true;
        true
    }

    /// Insert `child` immediately before `anchor` in `parent`'s children. If
    /// `anchor` is not a child of `parent`, falls back to appending.
    pub fn insert_before(&mut self, parent: NodeId, child: NodeId, anchor: NodeId) -> bool {
        if self.get(parent).is_none() || self.get(child).is_none() || parent == child {
            return false;
        }
        let Some(pos) = self
            .get(parent)
            .and_then(|p| p.children.iter().position(|&c| c == anchor))
        else {
            return self.append_child(parent, child);
        };
        self.detach(child);
        let (pt, ct) = (
            self.taffy_of(parent).unwrap(),
            self.taffy_of(child).unwrap(),
        );
        if self.taffy.insert_child_at_index(pt, pos, ct).is_err() {
            return false;
        }
        self.get_mut(parent).unwrap().children.insert(pos, child);
        self.get_mut(child).unwrap().parent = Some(parent);
        self.dirty = true;
        true
    }

    /// Detach `child` from `parent` without freeing it (DOM `removeChild`
    /// semantics — the node can be re-appended). Use `free` to destroy it.
    pub fn remove_child(&mut self, parent: NodeId, child: NodeId) -> bool {
        let is_child = self
            .get(child)
            .map(|c| c.parent == Some(parent))
            .unwrap_or(false);
        if !is_child {
            return false;
        }
        self.detach(child);
        self.dirty = true;
        true
    }

    /// Destroy a node and its whole subtree, freeing every render node *and* its
    /// taffy node (no leak). The root cannot be freed.
    pub fn free(&mut self, id: NodeId) -> bool {
        if id == self.root || self.get(id).is_none() {
            return false;
        }
        self.detach(id);
        self.free_subtree(id);
        self.dirty = true;
        true
    }

    fn free_subtree(&mut self, id: NodeId) {
        let Some(node) = self.get(id) else { return };
        let children = node.children.clone();
        let taffy = node.taffy;
        for c in children {
            self.free_subtree(c);
        }
        let _ = self.taffy.remove(taffy);
        self.measure_cache.remove(&taffy);
        let slot = &mut self.slots[id.index()];
        slot.node = None;
        // Bump generation so the freed handle can never resolve again; skip 0 on
        // wrap so a live node's generation field stays non-zero.
        slot.generation = match slot.generation.wrapping_add(1) & 0xFF {
            0 => 1,
            g => g,
        };
        self.free.push(id.index() as u32);
    }

    /// Apply a packed layout style to a node and mark the tree dirty.
    pub fn set_style(&mut self, id: NodeId, style: &StyleFfi) -> bool {
        let Some(taffy) = self.taffy_of(id) else {
            return false;
        };
        if self.taffy.set_style(taffy, style.into()).is_err() {
            return false;
        }
        self.dirty = true;
        true
    }

    /// Mark a node's content as changed so its size is recomputed. A `<text>`
    /// node is auto-sized from its runs by the measure pass, but taffy caches each
    /// node's layout — so a text/wrap change that doesn't also change the style
    /// must dirty the taffy node explicitly, or the cached (stale) size survives.
    pub fn mark_text_dirty(&mut self, id: NodeId) {
        // Stamp a fresh version so the measure cache treats this node's prior wrap
        // results as stale (its runs/wrap just changed). Other nodes keep theirs.
        self.version_counter += 1;
        let v = self.version_counter;
        let taffy = if let Some(node) = self.get_mut(id) {
            node.measure_version = v;
            Some(node.taffy)
        } else {
            None
        };
        if let Some(taffy) = taffy {
            let _ = self.taffy.mark_dirty(taffy);
        }
        self.dirty = true;
    }

    /// Run taffy over the tree sized to `width`×`height` cells, auto-sizing
    /// `<text>` nodes from their content via a measure callback, and clear the
    /// dirty flag. The measure closure needs to read render nodes while taffy
    /// borrows itself mutably; that disjoint borrow of `self.taffy` + `self.slots`
    /// is why this lives on `NodeTree` rather than in `layout.rs`.
    pub fn compute_layout(&mut self, width: u32, height: u32) {
        self.set_root_size(width, height);
        let Some(root_taffy) = self.get(self.root).map(|n| n.taffy) else {
            return;
        };
        // Disjoint field borrows: taffy mutably for the compute, slots immutably
        // for the node lookup, the measure cache mutably for memoized wrap results.
        let taffy = &mut self.taffy;
        let slots = &self.slots;
        let cache = &mut self.measure_cache;
        // Build a `TaffyId → node` map once per layout (O(N)) so each measure-
        // closure firing is an O(1) lookup. Taffy fires the closure once per leaf
        // PER intrinsic-sizing probe (min/max/definite) per pass — on a large tree
        // that's thousands of calls, so a per-call linear slab scan would be O(N²)
        // and dominate the frame.
        let index: HashMap<TaffyId, &RenderNode> = slots
            .iter()
            .filter_map(|s| s.node.as_ref())
            .map(|n| (n.taffy, n))
            .collect();
        let avail = Size {
            width: AvailableSpace::Definite(width as f32),
            height: AvailableSpace::Definite(height as f32),
        };
        if crate::perf::enabled() {
            // Timed path: count measure-closure firings and the time inside them
            // so the per-frame line can prove whether measure scales with changed
            // leaves (Taffy's cache holds) or all leaves (it doesn't).
            let start = Instant::now();
            let mut calls: u64 = 0;
            let mut measure_dur = Duration::ZERO;
            let _ = taffy.compute_layout_with_measure(
                root_taffy,
                avail,
                |_known, available_space, node_id, _ctx, _style| {
                    calls += 1;
                    let m0 = Instant::now();
                    let size = measure_node(&index, cache, node_id, available_space);
                    measure_dur += m0.elapsed();
                    size
                },
            );
            crate::perf::record_layout(start.elapsed(), calls, measure_dur);
        } else {
            let _ = taffy.compute_layout_with_measure(
                root_taffy,
                avail,
                |_known, available_space, node_id, _ctx, _style| {
                    measure_node(&index, cache, node_id, available_space)
                },
            );
        }
        self.dirty = false;
    }

    /// Resize the root to the terminal, preserving any other root style fields.
    /// A no-op when the size is unchanged, so re-composing an unchanged frame
    /// doesn't dirty the tree and force a needless re-layout.
    pub fn set_root_size(&mut self, width: u32, height: u32) {
        let Some(taffy) = self.taffy_of(self.root) else {
            return;
        };
        let want = Size {
            width: Dimension::length(width as f32),
            height: Dimension::length(height as f32),
        };
        let mut style = self
            .taffy
            .style(taffy)
            .cloned()
            .unwrap_or_else(|_| root_style(width, height));
        if style.size == want {
            return;
        }
        style.size = want;
        let _ = self.taffy.set_style(taffy, style);
        self.dirty = true;
    }

    /// Order-sensitive structural hash over `(kind, child handles)` walked
    /// pre-order from the root. The TS host computes the same hash over its
    /// mirror; an inequality means the two trees have diverged (a paint bug
    /// waiting to happen). FNV-1a so JS can reproduce it with plain integer math.
    pub fn debug_tree_hash(&self) -> u64 {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        self.hash_node(self.root, &mut h);
        h
    }

    fn hash_node(&self, id: NodeId, h: &mut u64) {
        let Some(node) = self.get(id) else { return };
        mix(h, node.kind.code() as u64);
        mix(h, node.children.len() as u64);
        for &c in &node.children {
            mix(h, c.0 as u64);
        }
        for &c in &node.children {
            self.hash_node(c, h);
        }
    }
}

#[inline]
fn mix(h: &mut u64, v: u64) {
    *h ^= v;
    *h = h.wrapping_mul(0x0000_0100_0000_01b3);
}

/// taffy measure callback: report the content size of a leaf node. Only `<text>`
/// is measured (its wrapped runs); every other leaf returns zero so taffy falls
/// back to its style size — exactly the pre-measure behaviour, so explicitly
/// sized nodes are untouched.
///
/// The wrap budget comes from `available_space.width`, NOT `known_dimensions`:
/// taffy passes `Size::NONE` for known dims during the layout pass but folds an
/// explicit/percentage width into `available_space`, and it applies "explicit
/// dims win" itself (`known.or(style_size).unwrap_or(measured)`), so this only
/// needs to return the content size.
///
/// The `TaffyId → RenderNode` lookup is O(1) via a map built once per layout in
/// `compute_layout`. Taffy fires this closure once per leaf per intrinsic-sizing
/// probe per pass, so a per-call slab scan would make a large tree O(N²).
fn measure_node(
    index: &HashMap<TaffyId, &RenderNode>,
    cache: &mut HashMap<TaffyId, MeasureCacheEntry>,
    taffy_id: TaffyId,
    available_space: Size<AvailableSpace>,
) -> Size<f32> {
    let zero = Size {
        width: 0.0,
        height: 0.0,
    };
    let Some(node) = index.get(&taffy_id) else {
        return zero;
    };
    if node.kind != NodeKind::Text {
        return zero;
    }
    // The wrap budget mirrors taffy's three intrinsic-sizing probes, which must
    // stay distinct: a definite width wraps to that width; a max-content probe
    // flows with a huge budget so the node reports its natural single-line width;
    // a min-content probe wraps as tightly as the mode allows (budget 1) so the
    // node reports its narrowest width — the widest token under word wrap, one
    // cell under char wrap. Collapsing min-content into max-content makes a text
    // node's automatic minimum size (`min-width: auto`) equal its full line, so a
    // `flex-grow` text child in a flex ROW can never shrink and its content
    // overflows instead of wrapping (e.g. a markdown list item: bullet + content).
    let budget = match available_space.width {
        AvailableSpace::Definite(w) => w.max(1.0) as u32,
        AvailableSpace::MaxContent => 1_000_000,
        AvailableSpace::MinContent => 1,
    };
    // Memoized fast path: an unchanged node (same `measure_version`) returns its
    // already-wrapped size for this budget without re-running the wrap. Taffy
    // re-invokes this for the whole tree whenever any distant node is dirtied, so
    // this cache is what keeps an animating/idle frame O(changed) not O(total).
    let entry = cache.entry(taffy_id).or_default();
    if entry.version != node.measure_version {
        entry.version = node.measure_version;
        entry.budgets.clear();
        entry.sizes.clear();
    } else if let Some(pos) = entry.budgets.iter().position(|&b| b == budget) {
        return entry.sizes[pos];
    }
    let size = match node.text.as_ref() {
        // A text node should always carry content; treat a missing one as a blank
        // line so it still reserves a row.
        None => Size {
            width: 0.0,
            height: 1.0,
        },
        Some(text) => {
            let mut buf = TextBuffer::new();
            buf.set_styled_runs(text.runs.iter().map(|run| StyledRun {
                text: &run.text,
                fg: run.fg,
                bg: run.bg,
                attrs: run.attrs,
            }));
            let mut view = TextBufferView::new(&buf);
            let measured = view.measure(budget, node.wrap);
            Size {
                width: measured.max_width as f32,
                height: measured.line_count as f32,
            }
        }
    };
    entry.budgets.push(budget);
    entry.sizes.push(size);
    size
}

/// Default root style: a flex container sized exactly to the terminal in cells.
fn root_style(width: u32, height: u32) -> Style {
    Style {
        size: Size {
            width: Dimension::length(width as f32),
            height: Dimension::length(height as f32),
        },
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::style::StyleFfi;
    use crate::text::WrapMode;
    use taffy::TraversePartialTree;

    fn set_text(t: &mut NodeTree, id: NodeId, s: &str, wrap: WrapMode) {
        let node = t.get_mut(id).unwrap();
        node.text = Some(TextContent {
            runs: vec![TextRun {
                text: s.to_string(),
                fg: None,
                bg: None,
                attrs: 0,
            }],
        });
        node.wrap = wrap;
    }

    fn len(value: f32) -> crate::style::DimFfi {
        crate::style::DimFfi { kind: 1, value }
    }

    /// A wrapped `<text>` that is a `flex-grow` child of a fixed-width flex ROW
    /// (the markdown list-item shape: bullet + growing content column) must shrink
    /// to the row's available width and wrap — not lay out at its natural single-
    /// line width and overflow. Regresses if a text node reports its max-content
    /// width as its MIN-content width (then `min-width:auto` pins the column wide).
    #[test]
    fn wrapped_text_in_flex_row_shrinks_to_available_width() {
        let mut t = NodeTree::new(40, 24);
        let root = t.root();

        let row = t.create(NodeKind::Box);
        let mut row_style = StyleFfi::default();
        row_style.flex_direction = 0; // row
        row_style.width = len(40.0);
        t.set_style(row, &row_style);
        t.append_child(root, row);

        let bullet = t.create(NodeKind::Text);
        set_text(&mut t, bullet, "• ", WrapMode::None);
        t.append_child(row, bullet);

        let content = t.create(NodeKind::Box);
        let mut content_style = StyleFfi::default();
        content_style.flex_direction = 1; // column
        content_style.align_items = 7; // stretch
        content_style.flex_grow = 1.0;
        t.set_style(content, &content_style);
        t.append_child(row, content);

        let txt = t.create(NodeKind::Text);
        set_text(
            &mut t,
            txt,
            "the quick brown fox jumps over the lazy dog and then keeps running",
            WrapMode::Word,
        );
        t.append_child(content, txt);

        t.compute_layout(40, 24);

        let txt_box = crate::layout::node_box(&t, txt).unwrap();
        // Bullet is 2 cells, so the wrapped text can be at most 38 cells wide.
        assert!(
            txt_box.w <= 38.0,
            "wrapped text overflowed its flex-row: width = {}",
            txt_box.w
        );
        // Wraps to exactly 2 lines at this width. The upper bound also locks that
        // the min-content probe's (tall) height never leaks into the final layout —
        // taffy must re-measure height against the resolved definite width.
        assert!(
            (2.0..=3.0).contains(&txt_box.h),
            "text should wrap to ~2 lines, got height {}",
            txt_box.h
        );
    }

    #[test]
    fn root_exists_and_is_root_kind() {
        let t = NodeTree::new(80, 24);
        let root = t.root();
        assert_eq!(t.get(root).unwrap().kind, NodeKind::Root);
        assert_ne!(root, NodeId::NULL);
    }

    /// The measure cache must NOT serve a stale size after a node's text changes.
    /// `mark_text_dirty` (the FFI text/wrap setters' shared tail) bumps the node's
    /// `measure_version`, which invalidates its cached wrap results.
    /// A fixed-width column (align stretch) whose single text child's height is its
    /// wrapped content height — a wrapped-text-in-a-pane shape. Returns (tree, text id).
    fn text_in_fixed_column(width: f32, s: &str) -> (NodeTree, NodeId) {
        let mut t = NodeTree::new((width as u32) + 20, 24);
        let root = t.root();
        let col = t.create(NodeKind::Box);
        let mut col_style = StyleFfi::default();
        col_style.flex_direction = 1; // column
        col_style.align_items = 7; // stretch (cross-axis = width)
        col_style.width = len(width);
        t.set_style(col, &col_style);
        t.append_child(root, col);
        let txt = t.create(NodeKind::Text);
        set_text(&mut t, txt, s, WrapMode::Word);
        t.mark_text_dirty(txt); // mirror vui_node_set_text_runs' dirty tail
        t.append_child(col, txt);
        (t, txt)
    }

    #[test]
    fn measure_cache_invalidates_on_text_change() {
        let (mut t, txt) = text_in_fixed_column(20.0, "hi");
        t.compute_layout(40, 24);
        let h1 = crate::layout::node_box(&t, txt).unwrap().h;
        assert_eq!(h1, 1.0, "single short line should be one row");

        // Replace with content that must wrap to several lines at width 20.
        set_text(
            &mut t,
            txt,
            "alpha bravo charlie delta echo foxtrot golf hotel india juliet",
            WrapMode::Word,
        );
        t.mark_text_dirty(txt);
        t.compute_layout(40, 24);
        let h2 = crate::layout::node_box(&t, txt).unwrap().h;
        assert!(
            h2 > h1,
            "stale measure cache: height did not grow after text change (h1={h1}, h2={h2})",
        );
    }

    /// A node whose content is unchanged keeps its size across re-layouts even when
    /// a DIFFERENT node is dirtied (the case the cache fixes: a frequently-changing
    /// sibling must not force the unchanged text to re-wrap to a wrong size).
    #[test]
    fn measure_cache_stable_when_unrelated_node_dirties() {
        // `a` wraps to several lines in a fixed-width column; `b` is a sibling that
        // changes every layout (a frequently-redrawn node).
        let (mut t, a) = text_in_fixed_column(20.0, "alpha bravo charlie delta echo foxtrot golf");
        let col = t.get(a).unwrap().parent.unwrap();
        let b = t.create(NodeKind::Text);
        set_text(&mut t, b, "x", WrapMode::Word);
        t.mark_text_dirty(b);
        t.append_child(col, b);

        t.compute_layout(40, 24);
        let a_h = crate::layout::node_box(&t, a).unwrap().h;
        assert!(a_h >= 2.0, "test setup: `a` should wrap to multiple lines, got {a_h}");

        // Dirty only `b` (a frequently-redrawn node) and re-layout; `a` is untouched.
        set_text(&mut t, b, "y", WrapMode::Word);
        t.mark_text_dirty(b);
        t.compute_layout(40, 24);
        assert_eq!(
            crate::layout::node_box(&t, a).unwrap().h,
            a_h,
            "unchanged node's measured height must survive an unrelated node's change",
        );
    }

    #[test]
    fn append_and_remove_keep_taffy_in_sync() {
        let mut t = NodeTree::new(80, 24);
        let root = t.root();
        let a = t.create(NodeKind::Box);
        let b = t.create(NodeKind::Box);
        assert!(t.append_child(root, a));
        assert!(t.append_child(root, b));
        assert_eq!(t.get(root).unwrap().children, vec![a, b]);
        assert_eq!(t.taffy.child_count(t.taffy_of(root).unwrap()), 2);
        // remove_child detaches but keeps the node alive (re-insertable).
        assert!(t.remove_child(root, a));
        assert_eq!(t.get(root).unwrap().children, vec![b]);
        assert_eq!(t.taffy.child_count(t.taffy_of(root).unwrap()), 1);
        assert!(t.get(a).is_some());
    }

    #[test]
    fn insert_before_positions_child() {
        let mut t = NodeTree::new(80, 24);
        let root = t.root();
        let a = t.create(NodeKind::Box);
        let b = t.create(NodeKind::Box);
        let c = t.create(NodeKind::Box);
        t.append_child(root, a);
        t.append_child(root, b);
        assert!(t.insert_before(root, c, b));
        assert_eq!(t.get(root).unwrap().children, vec![a, c, b]);
    }

    #[test]
    fn free_releases_render_and_taffy_nodes() {
        let mut t = NodeTree::new(80, 24);
        let root = t.root();
        let before = t.taffy_node_count();
        let a = t.create(NodeKind::Box);
        let child = t.create(NodeKind::Box);
        t.append_child(root, a);
        t.append_child(a, child);
        assert_eq!(t.taffy_node_count(), before + 2);
        // Freeing a subtree releases both its render nodes and taffy nodes.
        assert!(t.free(a));
        assert_eq!(t.taffy_node_count(), before);
        assert!(t.get(a).is_none());
        assert!(t.get(child).is_none());
    }

    #[test]
    fn stale_handle_does_not_alias_reused_slot() {
        let mut t = NodeTree::new(80, 24);
        let a = t.create(NodeKind::Box);
        assert!(t.free(a));
        // The freed slot is reused; the new handle differs by generation, so the
        // old handle must no longer resolve.
        let b = t.create(NodeKind::Box);
        assert_eq!(a.index(), b.index(), "slot index reused");
        assert_ne!(a, b, "generation differs");
        assert!(t.get(a).is_none(), "stale handle rejected");
        assert!(t.get(b).is_some());
    }

    #[test]
    fn root_cannot_be_freed() {
        let mut t = NodeTree::new(80, 24);
        let root = t.root();
        assert!(!t.free(root));
        assert!(t.get(root).is_some());
    }

    #[test]
    fn tree_hash_is_order_sensitive() {
        let mut t = NodeTree::new(80, 24);
        let root = t.root();
        let a = t.create(NodeKind::Box);
        let b = t.create(NodeKind::Text);
        t.append_child(root, a);
        t.append_child(root, b);
        let h1 = t.debug_tree_hash();
        // Reorder the same two children: the hash must change.
        t.remove_child(root, a);
        t.append_child(root, a); // now [b, a]
        let h2 = t.debug_tree_hash();
        assert_ne!(h1, h2);
    }
}
