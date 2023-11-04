import * as _ from 'lodash';
import { MockttpSerializedBuffer } from '../types';

// Before imports to avoid circular import with server-api
export const RUNNING_IN_WORKER = typeof window === 'undefined';

export type Empty = _.Dictionary<undefined>;
export function empty(): Empty {
    return {};
}

type Case<R> = [() => boolean, R | undefined];

export function firstMatch<R>(...tests: Array<Case<R> | R | undefined>): R | undefined {
    for (let test of tests) {
        if (_.isArray(test) && _.isFunction(test[0])) {
            const [matcher, result] = test;
            if (matcher() && result) return result;
        } else {
            if (test) return <R>test;
        }
    }
}

export function longestPrefix(baseString: string, ...strings: string[]) {
    let prefix = "";
    const shortestLength = Math.min(
        baseString.length,
        ...strings.map(s => s.length)
    );

    for (let i = 0; i < shortestLength; i++) {
        const char = baseString[i];
        if (!strings.every(s => s[i] === char)) break;
        prefix += char;
    }

    return prefix;
}

// In some places, we need a Buffer in theory, but we know for sure that it'll never
// be read, we just need to know its size (e.g. calculating compression stats).
// For those cases, it can be useful to *carefully* provide this fake buffer instead.
// Could actually allocate an empty buffer, but that's much more expensive if the
// buffer is large, and probably a waste.
export function fakeBuffer(byteLength: number): FakeBuffer {
    return { byteLength: byteLength };
}
export type FakeBuffer = { byteLength: number };

const encoder = new TextEncoder();

const strictDecoder = new TextDecoder('utf8', { fatal: true });
const laxDecoder = new TextDecoder('utf8', { fatal: false });
const binaryLaxDecoder = new TextDecoder('latin1', { fatal: false });

// Not a perfect or full check, but a quick test to see if the data in a buffer
// is valid UTF8 (so we should treat it as text) or not (so we should treat it as
// raw binary data). For viewing content as text we don't care (we just always show
// as UTF8) but for _editing_ binary data we need a lossless encoding, not utf8.
// (Monaco isn't perfectly lossless editing binary anyway, but we can try).
export function isProbablyUtf8(buffer: Buffer) {
    try {
        // Just check the first 1kb, in case it's a huge file
        const dataToCheck = buffer.slice(0, 1024);
        strictDecoder.decode(dataToCheck);
        return true; // Decoded OK, probably safe
    } catch (e) {
        return false; // Decoding failed, definitely not valid UTF8
    }
}

export function stringToBuffer(input: string, encoding: 'utf8' | 'binary' = 'utf8') {
    if (encoding === 'utf8') {
        return Buffer.from(encoder.encode(input)); // ~4x faster than Buffer.from(input, 'utf8')
    } else if (encoding === 'binary') {
        return Buffer.from(input, encoding); // Slower, but we have no option as TextEncoder is UTF8 only
    } else {
        throw new Error(`Cannot decode string from unrecogized encoding: ${encoding}`);
    }
}

export function bufferToString(input: Buffer, encoding: 'utf8' | 'binary' = 'utf8') {
    if (encoding === 'utf8') {
        return laxDecoder.decode(input); // ~5x faster than buffer.toString('utf8')
    } else if (encoding === 'binary') {
        return binaryLaxDecoder.decode(input);
    } else {
        throw new Error(`Cannot convert buffer to unrecogized encoding: ${encoding}`);
    }
}

export function isSerializedBuffer(obj: any): obj is MockttpSerializedBuffer {
    return obj && obj.type === 'Buffer' && !!obj.data;
}

export function asBuffer(data: string | Buffer | Uint8Array | MockttpSerializedBuffer | undefined): Buffer {
    if (!data) {
        return Buffer.from([]);
    } else if (Buffer.isBuffer(data)) {
        return data;
    } else if (typeof data === 'string') {
        return stringToBuffer(data);
    } else if (isSerializedBuffer(data)) {
        return Buffer.from(data.data);
    } else {
        // Extract internal data from uint8array (arrayview):
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }
}

// Get the length of the given data in bytes, not characters.
// If that's a buffer, the length is used raw, but if it's a string
// it returns the length when encoded as UTF8.
export function byteLength(input: string | Buffer | MockttpSerializedBuffer | Uint8Array | undefined) {
    if (!input) {
        return 0;
    } else if (typeof input === 'string') {
        return new Blob([input]).size;
    } else if (isSerializedBuffer(input)) {
        return input.data.length;
    } else {
        return input.length;
    }
}

export function tryParseJson(input: string): object | undefined {
    try {
        return JSON.parse(input);
    } catch (e) {
        return undefined;
    }
}

export function recursiveMapValues(
    input: unknown,
    fn: (value: unknown, key?: string) => unknown,
    key: string | undefined = undefined
): unknown {
    if (_.isArray(input)) {
        return input.map((innerObj) => recursiveMapValues(innerObj, fn));
    } else if (_.isPlainObject(input)) {
        return _.mapValues(input as {}, (val, key) => recursiveMapValues(val, fn, key));
    } else {
        return fn(input, key);
    }
}