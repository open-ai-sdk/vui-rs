//! `StyleFfi` is the packed, flat layout-style struct that crosses the FFI
//! boundary in one write (so a style change is a single FFI call, not dozens).
//! It is `#[repr(C)]` with every field a 4- or 8-byte primitive, so the JS side
//! can pack it into a plain `ArrayBuffer` with fixed offsets and no padding
//! guesswork. `From<&StyleFfi> for taffy::Style` is the only place taffy's style
//! types are constructed, so a taffy upgrade touches just this file and
//! `layout.rs`.
//!
//! Field order here is the ABI contract with `packages/core/src/style.ts`. Any
//! reorder/add/remove is an ABI change: bump `ABI_VERSION`. The size probe
//! `vui_style_ffi_size` lets the loader assert the TS packer agrees.

use taffy::geometry::{Rect, Size};
use taffy::style::{
    AlignItems, Dimension, Display, FlexDirection, FlexWrap, JustifyContent, LengthPercentage,
    LengthPercentageAuto, Position, Style,
};

/// One dimension value: `kind` selects the variant, `value` is its magnitude.
/// `kind`: 0 = auto, 1 = length (cells), 2 = percent (`value` is a 0.0–1.0
/// fraction, matching taffy's percent convention — NOT 0–100).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct DimFfi {
    pub kind: u32,
    pub value: f32,
}

mod dim_kind {
    pub const AUTO: u32 = 0;
    pub const LENGTH: u32 = 1;
    pub const PERCENT: u32 = 2;
}

impl DimFfi {
    /// An `auto` dimension (the CSS initial value for sizes and inset).
    pub const AUTO: DimFfi = DimFfi {
        kind: dim_kind::AUTO,
        value: 0.0,
    };
    /// A zero-length dimension (the CSS initial value for margin/padding/border).
    pub const ZERO: DimFfi = DimFfi {
        kind: dim_kind::LENGTH,
        value: 0.0,
    };
}

impl DimFfi {
    /// As a `Dimension` (size/min/max/flex-basis): all three kinds valid.
    fn to_dimension(self) -> Dimension {
        match self.kind {
            dim_kind::LENGTH => Dimension::length(self.value),
            dim_kind::PERCENT => Dimension::percent(self.value),
            dim_kind::AUTO => Dimension::auto(),
            _ => Dimension::auto(),
        }
    }

    /// As a `LengthPercentageAuto` (margin/inset): auto valid.
    fn to_lp_auto(self) -> LengthPercentageAuto {
        match self.kind {
            dim_kind::LENGTH => LengthPercentageAuto::length(self.value),
            dim_kind::PERCENT => LengthPercentageAuto::percent(self.value),
            dim_kind::AUTO => LengthPercentageAuto::auto(),
            _ => LengthPercentageAuto::auto(),
        }
    }

    /// As a `LengthPercentage` (padding/border/gap): auto is invalid here, so it
    /// clamps to zero rather than panicking on out-of-range data.
    fn to_lp(self) -> LengthPercentage {
        match self.kind {
            dim_kind::PERCENT => LengthPercentage::percent(self.value),
            dim_kind::LENGTH => LengthPercentage::length(self.value),
            _ => LengthPercentage::length(0.0),
        }
    }
}

/// Packed taffy style. Field order is the ABI contract; see module docs.
/// Enum fields are `u32` codes (see the `From` impl for the mapping); a 0 code
/// means "default / unset" and clamps to a safe taffy default — never a panic.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct StyleFfi {
    pub display: u32,
    pub position: u32,
    pub flex_direction: u32,
    pub flex_wrap: u32,
    pub align_items: u32,
    pub align_self: u32,
    pub justify_content: u32,
    pub flex_grow: f32,
    pub flex_shrink: f32,
    pub flex_basis: DimFfi,
    pub width: DimFfi,
    pub height: DimFfi,
    pub min_width: DimFfi,
    pub min_height: DimFfi,
    pub max_width: DimFfi,
    pub max_height: DimFfi,
    pub padding_left: DimFfi,
    pub padding_right: DimFfi,
    pub padding_top: DimFfi,
    pub padding_bottom: DimFfi,
    pub margin_left: DimFfi,
    pub margin_right: DimFfi,
    pub margin_top: DimFfi,
    pub margin_bottom: DimFfi,
    pub border_left: DimFfi,
    pub border_right: DimFfi,
    pub border_top: DimFfi,
    pub border_bottom: DimFfi,
    pub inset_left: DimFfi,
    pub inset_right: DimFfi,
    pub inset_top: DimFfi,
    pub inset_bottom: DimFfi,
    pub gap_width: DimFfi,
    pub gap_height: DimFfi,
}

impl Default for StyleFfi {
    /// CSS-initial values, so an unstyled node lays out like a default flex item.
    /// NOTE: margin/padding/border default to length-0 (NOT auto) — `margin:auto`
    /// would absorb free space and center/collapse the node. `inset` keeps the
    /// CSS default of `auto`. The TS packer (`style.ts`) seeds the same defaults.
    fn default() -> Self {
        StyleFfi {
            display: 0,
            position: 0,
            flex_direction: 0,
            flex_wrap: 0,
            align_items: 0,
            align_self: 0,
            justify_content: 0,
            flex_grow: 0.0,
            flex_shrink: 1.0,
            flex_basis: DimFfi::AUTO,
            width: DimFfi::AUTO,
            height: DimFfi::AUTO,
            min_width: DimFfi::AUTO,
            min_height: DimFfi::AUTO,
            max_width: DimFfi::AUTO,
            max_height: DimFfi::AUTO,
            padding_left: DimFfi::ZERO,
            padding_right: DimFfi::ZERO,
            padding_top: DimFfi::ZERO,
            padding_bottom: DimFfi::ZERO,
            margin_left: DimFfi::ZERO,
            margin_right: DimFfi::ZERO,
            margin_top: DimFfi::ZERO,
            margin_bottom: DimFfi::ZERO,
            border_left: DimFfi::ZERO,
            border_right: DimFfi::ZERO,
            border_top: DimFfi::ZERO,
            border_bottom: DimFfi::ZERO,
            inset_left: DimFfi::AUTO,
            inset_right: DimFfi::AUTO,
            inset_top: DimFfi::AUTO,
            inset_bottom: DimFfi::AUTO,
            gap_width: DimFfi::ZERO,
            gap_height: DimFfi::ZERO,
        }
    }
}

fn map_display(v: u32) -> Display {
    // Block layout isn't enabled in v0 (flexbox-only build), so code 2 (block)
    // falls back to Flex rather than referencing a gated variant.
    match v {
        1 => Display::None,
        _ => Display::Flex,
    }
}

fn map_position(v: u32) -> Position {
    match v {
        1 => Position::Absolute,
        _ => Position::Relative,
    }
}

fn map_flex_direction(v: u32) -> FlexDirection {
    match v {
        1 => FlexDirection::Column,
        2 => FlexDirection::RowReverse,
        3 => FlexDirection::ColumnReverse,
        _ => FlexDirection::Row,
    }
}

fn map_flex_wrap(v: u32) -> FlexWrap {
    match v {
        1 => FlexWrap::Wrap,
        2 => FlexWrap::WrapReverse,
        _ => FlexWrap::NoWrap,
    }
}

/// Shared code space for `align-items`/`align-self` and `justify-content`.
/// 0 = unset (`None` → taffy parent fallback / default). The `space_*` codes
/// only make sense for justify/align-content; `map_align_items` ignores them.
mod align_code {
    pub const START: u32 = 1;
    pub const END: u32 = 2;
    pub const FLEX_START: u32 = 3;
    pub const FLEX_END: u32 = 4;
    pub const CENTER: u32 = 5;
    pub const BASELINE: u32 = 6;
    pub const STRETCH: u32 = 7;
    pub const SPACE_BETWEEN: u32 = 8;
    pub const SPACE_EVENLY: u32 = 9;
    pub const SPACE_AROUND: u32 = 10;
}

fn map_align_items(v: u32) -> Option<AlignItems> {
    Some(match v {
        align_code::START => AlignItems::Start,
        align_code::END => AlignItems::End,
        align_code::FLEX_START => AlignItems::FlexStart,
        align_code::FLEX_END => AlignItems::FlexEnd,
        align_code::CENTER => AlignItems::Center,
        align_code::BASELINE => AlignItems::Baseline,
        align_code::STRETCH => AlignItems::Stretch,
        _ => return None,
    })
}

fn map_justify_content(v: u32) -> Option<JustifyContent> {
    Some(match v {
        align_code::START => JustifyContent::Start,
        align_code::END => JustifyContent::End,
        align_code::FLEX_START => JustifyContent::FlexStart,
        align_code::FLEX_END => JustifyContent::FlexEnd,
        align_code::CENTER => JustifyContent::Center,
        align_code::STRETCH => JustifyContent::Stretch,
        align_code::SPACE_BETWEEN => JustifyContent::SpaceBetween,
        align_code::SPACE_EVENLY => JustifyContent::SpaceEvenly,
        align_code::SPACE_AROUND => JustifyContent::SpaceAround,
        _ => return None,
    })
}

impl From<&StyleFfi> for Style {
    fn from(s: &StyleFfi) -> Self {
        Style {
            display: map_display(s.display),
            position: map_position(s.position),
            flex_direction: map_flex_direction(s.flex_direction),
            flex_wrap: map_flex_wrap(s.flex_wrap),
            align_items: map_align_items(s.align_items),
            align_self: map_align_items(s.align_self),
            justify_content: map_justify_content(s.justify_content),
            flex_grow: s.flex_grow,
            flex_shrink: s.flex_shrink,
            flex_basis: s.flex_basis.to_dimension(),
            size: Size {
                width: s.width.to_dimension(),
                height: s.height.to_dimension(),
            },
            min_size: Size {
                width: s.min_width.to_dimension(),
                height: s.min_height.to_dimension(),
            },
            max_size: Size {
                width: s.max_width.to_dimension(),
                height: s.max_height.to_dimension(),
            },
            padding: Rect {
                left: s.padding_left.to_lp(),
                right: s.padding_right.to_lp(),
                top: s.padding_top.to_lp(),
                bottom: s.padding_bottom.to_lp(),
            },
            margin: Rect {
                left: s.margin_left.to_lp_auto(),
                right: s.margin_right.to_lp_auto(),
                top: s.margin_top.to_lp_auto(),
                bottom: s.margin_bottom.to_lp_auto(),
            },
            border: Rect {
                left: s.border_left.to_lp(),
                right: s.border_right.to_lp(),
                top: s.border_top.to_lp(),
                bottom: s.border_bottom.to_lp(),
            },
            inset: Rect {
                left: s.inset_left.to_lp_auto(),
                right: s.inset_right.to_lp_auto(),
                top: s.inset_top.to_lp_auto(),
                bottom: s.inset_bottom.to_lp_auto(),
            },
            gap: Size {
                width: s.gap_width.to_lp(),
                height: s.gap_height.to_lp(),
            },
            ..Default::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The neutral base tests tweak one field at a time from.
    fn base() -> StyleFfi {
        StyleFfi::default()
    }

    #[test]
    fn default_margins_are_zero_not_auto() {
        // Regression guard: a default node must NOT get `margin:auto` (which would
        // center it / collapse its cross size). taffy default margin is length-0.
        let t: Style = (&base()).into();
        assert_eq!(t.margin.left, LengthPercentageAuto::length(0.0));
        assert_eq!(t.margin.top, LengthPercentageAuto::length(0.0));
        assert_eq!(t.flex_shrink, 1.0);
    }

    #[test]
    fn struct_is_flat_4_byte_aligned() {
        // The TS packer relies on no interior padding (every field 4/8 bytes).
        assert_eq!(std::mem::align_of::<StyleFfi>(), 4);
        // 7 u32 enums + 2 f32 + 25 DimFfi(8 bytes each) = 28 + 8 + 200 = 236.
        assert_eq!(std::mem::size_of::<StyleFfi>(), 236);
    }

    #[test]
    fn display_and_direction_map() {
        let mut s = base();
        s.display = 1;
        s.flex_direction = 1;
        let t: Style = (&s).into();
        assert_eq!(t.display, Display::None);
        assert_eq!(t.flex_direction, FlexDirection::Column);
    }

    #[test]
    fn dimensions_map_each_kind() {
        let mut s = base();
        s.width = DimFfi {
            kind: dim_kind::LENGTH,
            value: 20.0,
        };
        s.height = DimFfi {
            kind: dim_kind::PERCENT,
            value: 0.5,
        };
        let t: Style = (&s).into();
        assert_eq!(t.size.width, Dimension::length(20.0));
        assert_eq!(t.size.height, Dimension::percent(0.5));
        // auto stays auto
        assert_eq!(t.min_size.width, Dimension::auto());
    }

    #[test]
    fn padding_auto_clamps_to_zero() {
        // padding can't be auto in taffy; an auto-coded padding must not panic.
        let mut s = base();
        s.padding_left = DimFfi {
            kind: dim_kind::AUTO,
            value: 9.0,
        };
        let t: Style = (&s).into();
        assert_eq!(t.padding.left, LengthPercentage::length(0.0));
    }

    #[test]
    fn align_unset_is_none_set_maps() {
        let mut s = base();
        assert!(Style::from(&s).align_items.is_none());
        s.align_items = align_code::CENTER;
        s.justify_content = align_code::SPACE_BETWEEN;
        let t: Style = (&s).into();
        assert_eq!(t.align_items, Some(AlignItems::Center));
        assert_eq!(t.justify_content, Some(JustifyContent::SpaceBetween));
    }

    #[test]
    fn align_items_ignores_space_codes() {
        // space_* is meaningless for align-items; it must fall back to None.
        let mut s = base();
        s.align_items = align_code::SPACE_AROUND;
        assert!(Style::from(&s).align_items.is_none());
    }

    #[test]
    fn flex_grow_passes_through() {
        let mut s = base();
        s.flex_grow = 2.0;
        assert_eq!(Style::from(&s).flex_grow, 2.0);
    }
}
