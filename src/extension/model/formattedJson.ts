// A model's glTF JSON laid out for reading, with where each object and array is in the text, so
// a JSON pointer can be shown and a place in the text named. Free of VS Code APIs.

/** An object or array in the text: from its opening bracket to just past its closing one. */
interface Container {
  pointer: string;
  start: number;
  end: number;
  /** The container this one is in; -1 for the document itself. */
  parent: number;
}

const INDENT = '  ';

export class FormattedJson {
  readonly text: string;
  /** In the order they start, which is also each one before what it holds. */
  private readonly containers: Container[] = [];
  private readonly byPointer = new Map<string, number>();

  /** Throws if `json` isn't JSON. */
  constructor(json: string) {
    const parts: string[] = [];
    let offset = 0;
    const write = (text: string) => {
      parts.push(text);
      offset += text.length;
    };
    const visit = (value: unknown, pointer: string, depth: number, parent: number) => {
      if (value === null || typeof value !== 'object') {
        write(JSON.stringify(value) ?? 'null');
        return;
      }
      const index = this.containers.push({ pointer, start: offset, end: offset, parent }) - 1;
      this.byPointer.set(pointer, index);
      const inner = INDENT.repeat(depth + 1);
      const entries: [string, unknown][] = Array.isArray(value)
        ? value.map((item, i) => [String(i), item])
        : Object.entries(value);
      const array = Array.isArray(value);
      if (entries.length === 0) {
        write(array ? '[]' : '{}');
      } else {
        write(array ? '[\n' : '{\n');
        entries.forEach(([key, item], i) => {
          write(inner);
          if (!array) write(`${JSON.stringify(key)}: `);
          visit(item, `${pointer}/${escapeToken(key)}`, depth + 1, index);
          write(i < entries.length - 1 ? ',\n' : '\n');
        });
        write(`${INDENT.repeat(depth)}${array ? ']' : '}'}`);
      }
      this.containers[index].end = offset;
    };
    visit(JSON.parse(json), '', 0, -1);
    write('\n');
    this.text = parts.join('');
  }

  /**
   * Where a JSON pointer's value is in the text: the object or array it names, or the nearest
   * one that holds it, for a pointer to a single value or to something not in the document.
   */
  rangeOf(pointer: string): { start: number; end: number } {
    let path = pointer;
    for (;;) {
      const index = this.byPointer.get(path);
      if (index !== undefined) {
        const { start, end } = this.containers[index];
        return { start, end };
      }
      if (path === '') return { start: 0, end: this.text.length };
      path = path.slice(0, path.lastIndexOf('/'));
    }
  }

  /** The pointer of the innermost object or array around an offset in the text. */
  pointerAt(offset: number): string {
    // The last container to start at or before the offset, then out to one that holds it.
    let low = 0;
    let high = this.containers.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.containers[middle].start <= offset) low = middle;
      else high = middle - 1;
    }
    for (let index = low; index >= 0; index = this.containers[index].parent) {
      const container = this.containers[index];
      if (container.start <= offset && offset < container.end) return container.pointer;
    }
    return '';
  }
}

/** A key as a JSON pointer token: `~` and `/` escaped. */
function escapeToken(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}
