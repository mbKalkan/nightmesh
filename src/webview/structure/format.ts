/**
 * Numbers as the inspector shows them. Counts and sizes follow VS Code's display language; values
 * from the file keep a dot and no grouping, so they can be copied back into code or JSON.
 */
export class Formatter {
  private readonly integer: Intl.NumberFormat;
  private readonly decimal: Intl.NumberFormat;

  constructor(locale: string) {
    this.integer = numberFormat(locale, { maximumFractionDigits: 0 });
    this.decimal = numberFormat(locale, { maximumFractionDigits: 1 });
  }

  count(value: number): string {
    return this.integer.format(value);
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
