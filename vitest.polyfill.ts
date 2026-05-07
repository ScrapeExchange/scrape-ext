import { TextEncoder, TextDecoder } from 'node:util';

// Restore Node's TextEncoder/TextDecoder so that wxt/testing → esbuild's
// `new TextEncoder().encode("") instanceof Uint8Array` invariant holds.
// In a jsdom vm-context, `Uint8Array` belongs to a different realm than the
// one used internally by Node's TextEncoder, so we also need to align
// `globalThis.Uint8Array` with Node's built-in.  Buffer extends Node's
// Uint8Array, so walking two levels up the prototype chain is reliable.
const NodeUint8Array = Object.getPrototypeOf(
  Object.getPrototypeOf(Buffer.alloc(0)),
).constructor as typeof Uint8Array;

globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).Uint8Array = NodeUint8Array;
