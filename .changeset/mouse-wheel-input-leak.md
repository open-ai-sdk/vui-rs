---
"@vui-rs/core": patch
---

Stop mouse-wheel/drag bursts from leaking raw escape sequences (e.g. `[<64;29;25M`, `[<65;29;`) into a focused input. A mouse report split across stdin reads could be force-parsed as literal text on the idle/escape timeout: a partial SGR/X10 report is now kept buffered until the rest of the burst arrives, and a lone ESC flushed by the timer re-attaches to a CSI/SS3 body that arrives on the next read (the report was split right after its ESC byte) instead of that body printing as text.
