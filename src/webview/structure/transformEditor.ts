import type { TransformStrings } from '../../shared/protocol';
import {
  eulerDegrees,
  quaternionFromDegrees,
  sameTrs,
  withPath,
  type TransformPath,
  type Trs,
} from '../../shared/transforms';

const AXES = ['x', 'y', 'z'] as const;

/** Decimals shown: lengths and scales to the micrometre, angles to a thousandth of a degree. */
const DECIMALS: Readonly<Record<TransformPath, number>> = { translation: 6, rotation: 3, scale: 6 };

interface Row {
  inputs: HTMLInputElement[];
  note: HTMLElement;
}

/**
 * The inspector's fields for a node's position, rotation and scale, to type new values into
 * (D-069). A value is taken when the field is left or Enter is pressed, as one step to undo;
 * Escape puts back what it was. What an animation sets can't be changed.
 */
export class TransformEditor {
  readonly element: HTMLElement;
  private readonly rows: Record<TransformPath, Row>;
  private readonly revertButton: HTMLButtonElement;
  private node: number | undefined;
  /** The node as it is now, and as the saved file has it. */
  private now: Trs | undefined;
  private saved: Trs | undefined;
  /**
   * The rotation as angles. Kept while they still give the node's rotation, so the angles typed
   * stay as typed rather than turning into others that rotate the same.
   */
  private degrees: [number, number, number] = [0, 0, 0];

  constructor(
    private readonly strings: TransformStrings,
    private readonly edited: (node: number, from: Trs, to: Trs) => void,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'nm-transform';
    const labels: Record<TransformPath, string> = {
      translation: `${strings.position} (${strings.metres})`,
      rotation: `${strings.rotation} (${strings.degrees})`,
      scale: strings.scaleRow,
    };
    this.rows = Object.fromEntries(
      (['translation', 'rotation', 'scale'] as const).map((path) => [
        path,
        this.addRow(path, labels[path]),
      ]),
    ) as Record<TransformPath, Row>;
    this.revertButton = document.createElement('button');
    this.revertButton.type = 'button';
    this.revertButton.className = 'nm-button nm-button-secondary nm-transform-revert';
    this.revertButton.textContent = strings.reset;
    this.revertButton.title = strings.resetTitle;
    this.revertButton.addEventListener('click', () => {
      if (this.node !== undefined && this.now && this.saved) {
        this.edited(this.node, this.now, this.saved);
      }
    });
    this.element.append(this.revertButton);
  }

  private addRow(path: TransformPath, label: string): Row {
    const group = document.createElement('div');
    group.className = 'nm-transform-row';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    const name = document.createElement('span');
    name.className = 'nm-transform-label';
    name.textContent = label;
    name.title = label;
    group.append(name);
    const inputs = AXES.map((axis, index) => {
      const field = document.createElement('label');
      field.className = 'nm-transform-field';
      const letter = document.createElement('span');
      letter.className = `nm-axis nm-axis-${axis}`;
      letter.textContent = axis.toUpperCase();
      letter.setAttribute('aria-hidden', 'true');
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.className = 'nm-transform-input';
      input.setAttribute('aria-label', `${label} ${axis.toUpperCase()}`);
      input.addEventListener('change', () => this.take(path, index, input));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          this.take(path, index, input);
          input.select();
        } else if (event.key === 'Escape') {
          this.fill(path);
          input.select();
        } else {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      });
      field.append(letter, input);
      group.append(field);
      return input;
    });
    const note = document.createElement('span');
    note.className = 'nm-note nm-transform-note';
    note.id = `nm-transform-note-${path}`;
    note.textContent = this.strings.animated;
    note.hidden = true;
    this.element.append(group, note);
    return { inputs, note };
  }

  /**
   * Shows node `node`: `now` as it is, `saved` as the file has it, and with `locked` what an
   * animation sets.
   */
  show(node: number, now: Trs, saved: Trs, locked: ReadonlySet<TransformPath>): void {
    if (node !== this.node) this.degrees = eulerDegrees(now.rotation);
    this.node = node;
    this.saved = saved;
    for (const path of ['translation', 'rotation', 'scale'] as const) {
      const row = this.rows[path];
      const animated = locked.has(path);
      row.note.hidden = !animated;
      for (const input of row.inputs) {
        input.disabled = animated;
        if (animated) input.setAttribute('aria-describedby', row.note.id);
        else input.removeAttribute('aria-describedby');
      }
    }
    this.setNow(now);
  }

  /** The node as a handle in the view drags it, before the change is made. */
  live(node: number, now: Trs): void {
    if (node === this.node) this.setNow(now);
  }

  private setNow(now: Trs): void {
    this.now = now;
    if (!sameRotation(quaternionFromDegrees(this.degrees), now.rotation)) {
      this.degrees = eulerDegrees(now.rotation);
    }
    for (const path of ['translation', 'rotation', 'scale'] as const) this.fill(path);
    this.revertButton.disabled = !this.saved || sameTrs(now, this.saved);
  }

  /** Writes a row's values into its fields; the one being typed in only when asked to. */
  private fill(path: TransformPath): void {
    if (!this.now) return;
    const values = path === 'rotation' ? this.degrees : this.now[path];
    this.rows[path].inputs.forEach((input, index) => {
      input.value = shown(values[index], DECIMALS[path]);
      // A narrow inspector cuts long values short; the tooltip has them whole.
      input.title = input.value;
    });
  }

  /** Takes what was typed in a field: a number makes the change, anything else is undone. */
  private take(path: TransformPath, index: number, input: HTMLInputElement): void {
    const { node, now } = this;
    const typed = Number(input.value.trim().replace(',', '.'));
    if (node === undefined || !now || input.value.trim() === '' || !Number.isFinite(typed)) {
      this.fill(path);
      return;
    }
    const current = path === 'rotation' ? this.degrees : now[path];
    if (shown(current[index], DECIMALS[path]) === shown(typed, DECIMALS[path])) {
      this.fill(path);
      return;
    }
    const values = [...current];
    values[index] = typed;
    let to: Trs;
    if (path === 'rotation') {
      this.degrees = values as [number, number, number];
      to = withPath(now, 'rotation', quaternionFromDegrees(values));
    } else {
      to = withPath(now, path, values);
    }
    if (!sameTrs(now, to)) this.edited(node, now, to);
  }
}

function shown(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

/** Whether two quaternions turn the same way: q and -q do. */
function sameRotation(a: readonly number[], b: readonly number[]): boolean {
  const dot = a.reduce((sum, value, i) => sum + value * b[i], 0);
  return Math.abs(Math.abs(dot) - 1) < 1e-9;
}
