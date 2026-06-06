// `createApp` ties Vue to the vui-rs JS host: the retained Renderable tree,
// taffy-via-FFI layout, and the JS paint walk over a native cell buffer (see
// `host/`). It is a thin alias over `createHostApp` — there is one host. In
// interactive mode the host owns a `TerminalSession` (raw mode, alt screen,
// guaranteed restore) and pumps stdin → key parser → focus manager; an injected
// renderer / `altScreen: false` stays offscreen so tests never touch a tty.
import type { Component } from '@vue/runtime-core'
import { type HostMountOptions, type VuiHostApp, createHostApp } from './host/create-host-app.ts'

/** Mount options (renderer/size/altScreen/theme). Alias of the host's options. */
export type MountOptions = HostMountOptions
/** A mounted app handle (mount/unmount/renderer/context). Alias of the host app. */
export type VuiApp = VuiHostApp

/** Create a vui-rs app from a root component. Mount it with `.mount()`. */
export function createApp(rootComponent: Component, rootProps?: Record<string, unknown>): VuiApp {
  return createHostApp(rootComponent, rootProps)
}
