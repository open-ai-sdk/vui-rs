---
'@vui-rs/vue': patch
---

Markdown tables: size columns synchronously from the live terminal width instead
of an asynchronous post-layout measurement (`useElementRect`). The async path
rendered the first frame at a fallback width and then reflowed to the measured
width; when the host commits rendered rows to scrollback, that wrong-width first
frame was committed permanently and the taller fallback layout ghosted between the
corrected rows, leaving the table looking jumbled. The width is now known on the
first paint (and refreshed on resize), so the table is laid out correctly once.
The box is content-sized within a terminal-width budget, so it no longer depends
on async container measurement and can't overflow its viewport.
