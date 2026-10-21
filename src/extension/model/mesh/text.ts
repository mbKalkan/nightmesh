// Reading text formats (OBJ, MTL, ASCII STL and PLY) straight from their bytes: numbers are
// parsed without making a string of each, which is most of the time a large file takes.

const SPACE = 0x20;
const TAB = 0x09;
const CR = 0x0d;
const LF = 0x0a;
const PLUS = 0x2b;
const MINUS = 0x2d;
const DOT = 0x2e;
const ZERO = 0x30;
const NINE = 0x39;
const LOWER_E = 0x65;
const UPPER_E = 0x45;

/** Powers of ten a double holds exactly enough for parsing: 10^0 to 10^22. */
const POWERS = Array.from({ length: 23 }, (_, power) => 10 ** power);

const isSpace = (byte: number) => byte === SPACE || byte === TAB || byte === CR;

/** A position in one line of text, from which words and numbers are read in turn. */
export class Cursor {
  bytes: Uint8Array = new Uint8Array(0);
  pos = 0;
  end = 0;

  /** Points the cursor at `bytes` from `start` to `end`, a line without its line break. */
  reset(bytes: Uint8Array, start: number, end: number): this {
    this.bytes = bytes;
    this.pos = start;
    this.end = end;
    return this;
  }

  skipSpaces(): void {
    while (this.pos < this.end && isSpace(this.bytes[this.pos])) this.pos++;
  }

  atEnd(): boolean {
    this.skipSpaces();
    return this.pos >= this.end;
  }

  /** The next word, up to a space; empty at the end of the line. */
  word(): string {
    this.skipSpaces();
    const start = this.pos;
    while (this.pos < this.end && !isSpace(this.bytes[this.pos])) this.pos++;
    return decodeText(this.bytes.subarray(start, this.pos));
  }

  /** True if the next word is exactly `keyword`, which is then skipped. */
  keyword(keyword: string): boolean {
    this.skipSpaces();
    const { bytes, pos } = this;
    if (pos + keyword.length > this.end) return false;
    for (let i = 0; i < keyword.length; i++) {
      if (bytes[pos + i] !== keyword.charCodeAt(i)) return false;
    }
    const after = pos + keyword.length;
    if (after < this.end && !isSpace(bytes[after])) return false;
    this.pos = after;
    return true;
  }

  /** The rest of the line, without the spaces around it. */
  rest(): string {
    this.skipSpaces();
    let end = this.end;
    while (end > this.pos && isSpace(this.bytes[end - 1])) end--;
    const text = decodeText(this.bytes.subarray(this.pos, end));
    this.pos = this.end;
    return text;
  }

  /**
   * The next word as a number: NaN when it isn't one, or at the end of the line. Digits past what
   * a double holds only scale the value, as they would round away.
   */
  number(): number {
    this.skipSpaces();
    const { bytes, end } = this;
    let pos = this.pos;
    const start = pos;
    if (pos >= end) return Number.NaN;
    let negative = false;
    if (pos < end && (bytes[pos] === MINUS || bytes[pos] === PLUS)) {
      negative = bytes[pos] === MINUS;
      pos++;
    }
    let mantissa = 0;
    let digits = 0;
    let exponent = 0;
    let seen = false;
    while (pos < end) {
      const byte = bytes[pos];
      if (byte < ZERO || byte > NINE) break;
      seen = true;
      if (digits < 17) {
        mantissa = mantissa * 10 + (byte - ZERO);
        if (mantissa !== 0) digits++;
      } else {
        exponent++;
      }
      pos++;
    }
    if (pos < end && bytes[pos] === DOT) {
      pos++;
      while (pos < end) {
        const byte = bytes[pos];
        if (byte < ZERO || byte > NINE) break;
        seen = true;
        if (digits < 17) {
          mantissa = mantissa * 10 + (byte - ZERO);
          if (mantissa !== 0) digits++;
          exponent--;
        }
        pos++;
      }
    }
    if (!seen) return this.special(start);
    if (pos < end && (bytes[pos] === LOWER_E || bytes[pos] === UPPER_E)) {
      let at = pos + 1;
      let negativeExponent = false;
      if (at < end && (bytes[at] === MINUS || bytes[at] === PLUS)) {
        negativeExponent = bytes[at] === MINUS;
        at++;
      }
      let value = 0;
      let exponentDigits = 0;
      while (at < end && bytes[at] >= ZERO && bytes[at] <= NINE) {
        if (value < 10000) value = value * 10 + (bytes[at] - ZERO);
        exponentDigits++;
        at++;
      }
      if (exponentDigits > 0) {
        exponent += negativeExponent ? -value : value;
        pos = at;
      }
    }
    if (pos < end && !isSpace(bytes[pos])) return this.special(start);
    this.pos = pos;
    let value: number;
    if (exponent === 0) value = mantissa;
    else if (exponent > 0)
      value = exponent < POWERS.length ? mantissa * POWERS[exponent] : mantissa * 10 ** exponent;
    else
      value = -exponent < POWERS.length ? mantissa / POWERS[-exponent] : mantissa / 10 ** -exponent;
    return negative ? -value : value;
  }

  /** `nan`, `inf` and the like, which some exporters write; any other word is not a number. */
  private special(start: number): number {
    this.pos = start;
    const match = /^([+-]?)(nan|inf|infinity)$/.exec(this.word().toLowerCase());
    if (!match || match[2] === 'nan') return Number.NaN;
    return match[1] === '-' ? -Infinity : Infinity;
  }

  /**
   * The next whole number, which may be negative; NaN when the next word doesn't start with one.
   * Stops at a `/`, so OBJ's `1/2/3` reads as three.
   */
  integer(): number {
    this.skipSpaces();
    const { bytes, end } = this;
    let pos = this.pos;
    let negative = false;
    if (pos < end && (bytes[pos] === MINUS || bytes[pos] === PLUS)) {
      negative = bytes[pos] === MINUS;
      pos++;
    }
    let value = 0;
    const first = pos;
    while (pos < end && bytes[pos] >= ZERO && bytes[pos] <= NINE) {
      value = value * 10 + (bytes[pos] - ZERO);
      pos++;
    }
    if (pos === first) return Number.NaN;
    this.pos = pos;
    return negative ? -value : value;
  }

  /** Skips one `/` if it is next, as between OBJ's vertex, texture and normal indices. */
  slash(): boolean {
    if (this.pos < this.end && this.bytes[this.pos] === 0x2f) {
      this.pos++;
      return true;
    }
    return false;
  }

  /** True when the next byte ends a word: a space, the end, or nothing at all. */
  atWordEnd(): boolean {
    return this.pos >= this.end || isSpace(this.bytes[this.pos]);
  }
}

/**
 * Splits text that arrives in pieces into lines, without the line breaks. A line within one piece
 * is handed out where it is; only a line split between pieces is copied.
 */
export class LineSplitter {
  private carry: Uint8Array | undefined;

  constructor(private readonly line: (bytes: Uint8Array, start: number, end: number) => void) {}

  push(chunk: Uint8Array): void {
    let start = 0;
    if (this.carry) {
      const newline = chunk.indexOf(LF);
      if (newline < 0) {
        this.carry = concat(this.carry, chunk);
        return;
      }
      const joined = concat(this.carry, chunk.subarray(0, newline));
      this.carry = undefined;
      this.emit(joined, 0, joined.length);
      start = newline + 1;
    }
    for (;;) {
      const newline = chunk.indexOf(LF, start);
      if (newline < 0) break;
      this.emit(chunk, start, newline);
      start = newline + 1;
    }
    if (start < chunk.length) this.carry = chunk.slice(start);
  }

  /** Hands out the last line, which has no line break after it. */
  finish(): void {
    const carry = this.carry;
    this.carry = undefined;
    if (carry) this.emit(carry, 0, carry.length);
  }

  private emit(bytes: Uint8Array, start: number, end: number): void {
    if (end > start && bytes[end - 1] === CR) end--;
    this.line(bytes, start, end);
  }
}

export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a);
  joined.set(b, a.length);
  return joined;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
const latin1 = new TextDecoder('latin1');

/**
 * Text as it is in the file, for names and comments: UTF-8, or Latin-1 where it isn't (older
 * exporters write names in the system's code page), or UTF-16 after its byte order mark.
 */
export function decodeText(bytes: Uint8Array): string {
  const encoding = utf16(bytes);
  if (encoding) return new TextDecoder(encoding).decode(bytes);
  try {
    return utf8.decode(bytes);
  } catch {
    return latin1.decode(bytes);
  }
}

/** The UTF-16 encoding text in `bytes` is in, by its byte order mark; undefined if none. */
export function utf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return undefined;
}
