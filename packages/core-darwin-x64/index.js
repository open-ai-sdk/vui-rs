// Path to the prebuilt vui-core cdylib for this platform. The `type: "file"`
// import attribute makes `bun build --compile` embed the binary into the
// executable's virtual filesystem; at plain runtime it resolves to the real
// on-disk path inside this package.
import libPath from './libvui_core.dylib' with { type: 'file' }
export default libPath
