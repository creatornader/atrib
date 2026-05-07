/* @ts-self-types="./atrib_directory_bridge.d.ts" */

/**
 * In-process AKD directory handle. Holds a single in-memory database
 * instance and provides the publish/lookup/history/audit operations.
 *
 * Production deployments will typically replace `AsyncInMemoryDatabase`
 * with a persistent backend (e.g., a SQLite-backed `Database` impl).
 * The bridge surface stays identical.
 */
class DirectoryHandle {
    static __wrap(ptr) {
        const obj = Object.create(DirectoryHandle.prototype);
        obj.__wbg_ptr = ptr;
        DirectoryHandleFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DirectoryHandleFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_directoryhandle_free(ptr, 0);
    }
    /**
     * Generate an audit proof between two epochs (verifies append-only consistency).
     *
     * Per §6.3 step 5: verifiers use this to confirm the directory has not
     * rolled back between two anchored checkpoints.
     * @param {bigint} from_epoch
     * @param {bigint} to_epoch
     * @returns {Promise<Uint8Array>}
     */
    audit_proof(from_epoch, to_epoch) {
        const ret = wasm.directoryhandle_audit_proof(this.__wbg_ptr, from_epoch, to_epoch);
        return ret;
    }
    /**
     * Get current epoch number.
     * @returns {Promise<bigint>}
     */
    current_epoch() {
        const ret = wasm.directoryhandle_current_epoch(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get current root hash (hex-encoded). Anchored into the tlog as the
     * `directory_root` field of a `directory_anchor` record per §6.2.4.
     * @returns {Promise<string>}
     */
    current_root() {
        const ret = wasm.directoryhandle_current_root(this.__wbg_ptr);
        return ret;
    }
    /**
     * Retrieve the full version chain for a label (publish + rotations + revocations).
     *
     * Returns `{ versions: [{ value, version, epoch }], proof: bytes }`.
     * Returns `{ versions: [], proof: empty }` for an unregistered label.
     * @param {string} label
     * @returns {Promise<any>}
     */
    history(label) {
        const ptr0 = passStringToWasm0(label, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.directoryhandle_history(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Look up a label's current value at the latest epoch.
     *
     * Returns `{ value: hex, version: u64, proof: bincode_bytes }` for
     * membership, or `null` for an unregistered label (when the AKD
     * returns a NotFound storage error, indicating no claim exists).
     *
     * A future `prove_absence` method will return a verifiable
     * non-membership proof; this method's null-on-miss is a soft
     * fallback for callers that only need binary membership.
     * @param {string} label
     * @returns {Promise<any>}
     */
    lookup(label) {
        const ptr0 = passStringToWasm0(label, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.directoryhandle_lookup(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Create a new empty directory.
     */
    constructor() {
        const ret = wasm.directoryhandle_new();
        return ret;
    }
    /**
     * Publish a batch of (label, value) pairs as a single epoch.
     *
     * Per §6.2.4 per-operation anchoring, callers SHOULD invoke this
     * once per logical update and emit a `directory_anchor` log entry
     * after each successful publish.
     *
     * Returns the new epoch number.
     * @param {Array<any>} labels
     * @param {Array<any>} values
     * @returns {Promise<bigint>}
     */
    publish_batch(labels, values) {
        const ret = wasm.directoryhandle_publish_batch(this.__wbg_ptr, labels, values);
        return ret;
    }
}
if (Symbol.dispose) DirectoryHandle.prototype[Symbol.dispose] = DirectoryHandle.prototype.free;
exports.DirectoryHandle = DirectoryHandle;

function init() {
    wasm.init();
}
exports.init = init;

/**
 * Verify an AKD audit (append-only) proof against a sequence of root hashes.
 *
 * Per spec §6.3 step 5. Takes (a) the concatenated 32-byte root hashes
 * captured at each anchored checkpoint between two epochs, in order
 * (so for epochs e..f, that's `f - e + 1` hashes = `(f-e+1)*32` bytes),
 * and (b) the bincode-serialized audit proof from the `/v6/audit-proof`
 * endpoint.
 *
 * We inline akd's `audit_verify` rather than calling the upstream
 * function because upstream's `verify_append_only_hash` hardcodes
 * `AzksParallelismConfig::default()` (= `AvailableOr(32)`) which calls
 * `std::thread::available_parallelism()` and tries to spawn parallel
 * Tokio tasks. WASM has no Tokio executor, so the upstream path panics
 * with `RuntimeError: unreachable`. Our inlined path passes
 * `AzksParallelismConfig::disabled()` everywhere.
 *
 * Async because the underlying AKD storage backend is async; no actual I/O.
 * @param {Uint8Array} hashes_concat
 * @param {Uint8Array} proof_bytes
 * @returns {Promise<boolean>}
 */
function verify_audit_proof(hashes_concat, proof_bytes) {
    const ptr0 = passArray8ToWasm0(hashes_concat, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(proof_bytes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.verify_audit_proof(ptr0, len0, ptr1, len1);
    return ret;
}
exports.verify_audit_proof = verify_audit_proof;

/**
 * Verify an AKD lookup proof against a known root hash.
 *
 * Per spec §6.3 step 7. The verifier holds (a) the directory operator's
 * VRF public key (out of band; for HardCodedAkdVRF use [`vrf_public_key`]),
 * (b) the anchored root hash at the proof's epoch (from a `directory_anchor`
 * log entry), (c) the directory's current epoch, (d) the looked-up label,
 * and (e) the bincode-serialized lookup proof from the `/v6/lookup/:key`
 * endpoint.
 *
 * Wraps [`akd_core::verify::lookup_verify`] which is `pub fn` and pure.
 * @param {Uint8Array} vrf_public_key
 * @param {Uint8Array} root_hash
 * @param {bigint} current_epoch
 * @param {string} label
 * @param {Uint8Array} proof_bytes
 * @returns {boolean}
 */
function verify_lookup_proof(vrf_public_key, root_hash, current_epoch, label, proof_bytes) {
    const ptr0 = passArray8ToWasm0(vrf_public_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(root_hash, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(label, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(proof_bytes, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.verify_lookup_proof(ptr0, len0, ptr1, len1, current_epoch, ptr2, len2, ptr3, len3);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}
exports.verify_lookup_proof = verify_lookup_proof;

/**
 * Return the VRF public key for the bridge's `HardCodedAkdVRF`.
 *
 * Verifiers need the operator's VRF public key to validate lookup
 * proofs. For production directories the operator publishes their own
 * VRF pubkey in their identity claim or a dedicated record. For this
 * reference implementation (which uses `HardCodedAkdVRF` per
 * `DirectoryHandle::new`), the key is constant and exposed here.
 *
 * Returns the 32-byte VRF public key.
 * @returns {Promise<Uint8Array>}
 */
function vrf_public_key() {
    const ret = wasm.vrf_public_key();
    return ret;
}
exports.vrf_public_key = vrf_public_key;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_3639a60ed15f87e7: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_debug_string_07cb72cfcc952e2b: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_function_2f0fd7ceb86e64c5: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_undefined_244a92c34d3b6ec0: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_string_get_965592073e5d848c: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_9c75d47bf9e7731e: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_158e43e869788cdc: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_call_a41d6421b30a32c5: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_directoryhandle_new: function(arg0) {
            const ret = DirectoryHandle.__wrap(arg0);
            return ret;
        },
        __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_get_652f640b3b0b6e3e: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_length_0a6ce016dc1460b0: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_new_2fad8ca02fd00684: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_3baa8d9866155c79: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_typed_1137602701dc87d4: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h749a7649ee04df0f(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_queueMicrotask_40ac6ffc2848ba77: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_queueMicrotask_74d092439f6494c1: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_resolve_9feb5d906ca62419: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
            arg0[arg1] = arg2;
        },
        __wbg_set_f614f6a0608d1d1d: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_static_accessor_GLOBAL_THIS_1c7f1bd6c6941fdb: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_e039bc914f83e74e: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_8bf8c48c28420ad5: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_6aeee9b51652ee0f: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_then_20a157d939b514f5: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 168, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h5693a240b404b655);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_cast_0000000000000005: function(arg0, arg1) {
            var v0 = getArrayU8FromWasm0(arg0, arg1).slice();
            wasm.__wbindgen_free(arg0, arg1 * 1, 1);
            // Cast intrinsic for `Vector(U8) -> Externref`.
            const ret = v0;
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./atrib_directory_bridge_bg.js": import0,
    };
}

function wasm_bindgen__convert__closures_____invoke__h5693a240b404b655(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h5693a240b404b655(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen__convert__closures_____invoke__h749a7649ee04df0f(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen__convert__closures_____invoke__h749a7649ee04df0f(arg0, arg1, arg2, arg3);
}

const DirectoryHandleFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_directoryhandle_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/atrib_directory_bridge_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();
