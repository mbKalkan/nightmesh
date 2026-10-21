import type { LengthUnit } from '../../shared/protocol';
import { UNIT_METRES } from '../units';

/**
 * A size along X, Y and Z without rounding noise: a flat model, turned to stand up, measures a
 * hair (1e-16) thick, which is shown as 0.
 */
export function withoutNoise(values: readonly number[]): number[] {
  const largest = Math.max(...values.map(Math.abs));
  return values.map((value) => (Math.abs(value) < largest * 1e-9 ? 0 : value));
}

/**
 * Numbers as the inspector shows them. Counts and sizes follow VS Code's display language; values
 * from the file keep a dot and no grouping, so they can be copied back into code or JSON. Lengths
 * are given in metres and shown in the unit set, the file's own for OBJ, STL and PLY.
 */
export class Formatter {
  private readonly integer: Intl.NumberFormat;
  private readonly decimal: Intl.NumberFormat;
  private readonly length: Intl.NumberFormat;
  private unit: LengthUnit = 'm';

  constructor(locale: string) {
    this.integer = numberFormat(locale, { maximumFractionDigits: 0 });
    this.decimal = numberFormat(locale, { maximumFractionDigits: 1 });
    this.length = numberFormat(locale, { maximumSignificantDigits: 4 });
  }

  count(value: number): string {
    return this.integer.format(value);
  }

  /** Shows lengths, which are given in metres, in `unit`. */
  setLength(unit: LengthUnit): void {
    this.unit = unit;
  }

  /** The unit lengths are shown in. */
  get lengthUnit(): LengthUnit {
    return this.unit;
  }

  /**
   * A length given in metres, for reading, not copying: in the unit set, to four significant
   * digits, with the user's decimals.
   */
  metres(value: number): string {
    const shown = Number((value / UNIT_METRES[this.unit]).toPrecision(4));
    return `${this.length.format(shown)} ${this.unit}`;
  }

  bytes(value: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }
    return `${unit === 0 ? this.integer.format(size) : this.decimal.format(size)} ${units[unit]}`;
  }

  /** At most six significant digits, without trailing zeros: 0.1 rather than 0.10000000149. */
  value(value: number): string {
    if (Number.isInteger(value)) return String(value);
    const rounded = Number(value.toPrecision(6));
    return Object.is(rounded, -0) ? '0' : String(rounded);
  }

  vector(values: readonly number[]): string {
    return `[${values.map((value) => this.value(value)).join(', ')}]`;
  }

  /**
   * A size along X, Y and Z given in metres, in the unit set, to four significant digits as the
   * size in the view gives it.
   */
  dimensions(values: readonly number[]): string {
    const shown = withoutNoise(values).map((value) =>
      Number((value / UNIT_METRES[this.unit]).toPrecision(4)),
    );
    return `${this.vector(shown)} ${this.unit}`;
  }

  /** An area in the file's own unit, squared: an OBJ, STL or PLY file's. */
  area(value: number): string {
    return `${this.length.format(Number(value.toPrecision(4)))} ${this.unit}²`;
  }

  /**
   * A volume in the file's own unit, cubed, and for millimetres in cubic centimetres too, as
   * 3D printing gives a print's material.
   */
  volume(value: number): string {
    const cubed = `${this.length.format(Number(value.toPrecision(4)))} ${this.unit}³`;
    if (this.unit !== 'mm') return cubed;
    return `${cubed} (${this.length.format(Number((value / 1000).toPrecision(4)))} cm³)`;
  }

  degrees(radians: number): string {
    return `${this.value(Number(((radians * 180) / Math.PI).toFixed(3)))}°`;
  }

  seconds(value: number): string {
    return `${this.value(Number(value.toFixed(3)))} s`;
  }
}

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, options);
  } catch {
    return new Intl.NumberFormat('en', options);
  }
}

/** Fills `{0}`, `{1}` … in a localized template. */
export const fill = (template: string, ...values: Array<string | number>): string =>
  template.replace(/\{(\d+)\}/g, (match, index: string) => String(values[Number(index)] ?? match));
