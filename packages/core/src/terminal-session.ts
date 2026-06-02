// Owns the terminal's interactive modes for the lifetime of an app: raw-mode
// stdin, the alt screen, a hidden cursor, and bracketed paste. The cardinal rule
// (pi-style) is GUARANTEED RESTORE — the teardown is idempotent and wired to
// `exit`, `SIGINT`/`SIGTERM`, and `uncaughtException`, so no code path can leave
// the terminal in raw/alt-screen state, not even a thrown error mid-render.
//
// Streams are injectable so tests can drive a mock terminal and assert the
// enter/restore sequences and that teardown runs exactly once.

const decoder = new TextDecoder();

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const PASTE_ON = "\x1b[?2004h";
const PASTE_OFF = "\x1b[?2004l";

/** The slice of `process.stdin` this module needs (injectable for tests). */
export interface InputStream {
  isTTY?: boolean;
  setRawMode?(mode: boolean): void;
  resume?(): void;
  pause?(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
}

/** The slice of `process.stdout` this module needs (injectable for tests). */
export interface OutputStream {
  columns?: number;
  rows?: number;
  write(data: string): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
}

export interface TerminalSessionOptions {
  input?: InputStream;
  output?: OutputStream;
  /** Enter the alt screen on start / leave it on stop. Default true. */
  altScreen?: boolean;
  /** Wire exit/signal/uncaught handlers for guaranteed restore. Default true. */
  installSignalHandlers?: boolean;
}

export interface TerminalSession {
  /** Enter raw mode + alt screen, begin emitting data/resize callbacks. */
  start(): void;
  onData(cb: (data: string) => void): void;
  onResize(cb: (cols: number, rows: number) => void): void;
  /** Idempotent restore: leave raw/alt-screen state, detach all listeners. */
  stop(): void;
  readonly size: { cols: number; rows: number };
}

function toText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (chunk instanceof Uint8Array) return decoder.decode(chunk);
  return String(chunk);
}

export function createTerminalSession(options: TerminalSessionOptions = {}): TerminalSession {
  const input = options.input ?? (process.stdin as unknown as InputStream);
  const output = options.output ?? (process.stdout as unknown as OutputStream);
  const altScreen = options.altScreen ?? true;
  const installSignals = options.installSignalHandlers ?? true;

  let started = false;
  let restored = false;
  let dataCb: ((data: string) => void) | null = null;
  let resizeCb: ((cols: number, rows: number) => void) | null = null;

  const onDataRaw = (chunk: unknown): void => dataCb?.(toText(chunk));
  const onResizeRaw = (): void => resizeCb?.(output.columns ?? 0, output.rows ?? 0);
  const onSignal = (): void => {
    stop();
    process.exit(0);
  };
  const onUncaught = (err: unknown): void => {
    stop();
    // Restore done; rethrow on the next tick so the default crash reporting fires.
    process.nextTick(() => {
      throw err;
    });
  };

  function start(): void {
    if (started) return;
    started = true;
    input.setRawMode?.(true);
    output.write((altScreen ? ENTER_ALT : "") + HIDE_CURSOR + PASTE_ON);
    input.resume?.();
    input.on("data", onDataRaw);
    output.on("resize", onResizeRaw);
    if (installSignals) {
      process.once("exit", stop);
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
      process.once("uncaughtException", onUncaught);
    }
  }

  function stop(): void {
    if (restored) return;
    restored = true;
    input.off("data", onDataRaw);
    output.off("resize", onResizeRaw);
    input.setRawMode?.(false);
    input.pause?.();
    output.write(PASTE_OFF + SHOW_CURSOR + (altScreen ? LEAVE_ALT : ""));
    if (installSignals) {
      process.off("exit", stop);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      process.off("uncaughtException", onUncaught);
    }
  }

  return {
    start,
    stop,
    onData: (cb) => {
      dataCb = cb;
    },
    onResize: (cb) => {
      resizeCb = cb;
    },
    get size() {
      return { cols: output.columns ?? 0, rows: output.rows ?? 0 };
    },
  };
}
