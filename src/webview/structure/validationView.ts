import type {
  Severity,
  ValidationMessage,
  ValidationReport,
  ValidationStrings,
} from '../../shared/protocol';
import { icons } from '../icons';
import { fill, type Formatter } from './format';
import type { EntryKey } from './outline';

const SEVERITIES: Severity[] = ['error', 'warning', 'info', 'hint'];

const ICONS: Record<Severity, string> = {
  error: icons.issueError,
  warning: icons.issueWarning,
  info: icons.issueInfo,
  hint: icons.issueHint,
};

/** Where the validation is: not started, running, or done with what it found. */
type State =
  | { kind: 'waiting' }
  | { kind: 'running'; previous?: ValidationReport }
  | { kind: 'done'; report: ValidationReport }
  | { kind: 'tooLarge'; bytes: number }
  | { kind: 'failed' };

export interface ValidationLinks {
  /** The structure entry an issue's JSON pointer is about, if there is one. */
  entryAt(pointer: string): EntryKey | undefined;
  /** An entry as a tooltip names it. */
  describe(key: EntryKey): string | undefined;
  select(key: EntryKey): void;
}

/**
 * The validation tab: what the Khronos glTF Validator found, errors first. Buttons above the list
 * show how many of each severity there are and hide or show them; an issue's JSON pointer is a
 * link to the entry it is about.
 */
export class ValidationView {
  readonly element: HTMLElement;
  private state: State = { kind: 'waiting' };
  private readonly hidden = new Set<Severity>();

  constructor(
    private readonly strings: ValidationStrings,
    private readonly format: Formatter,
    private readonly links: ValidationLinks,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'nm-validation';
    this.element.tabIndex = 0;
    this.element.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const key = target.closest<HTMLElement>('[data-key]')?.dataset.key;
      if (key !== undefined) return this.links.select(key);
      const severity = target.closest<HTMLElement>('[data-severity]')?.dataset.severity;
      if (!severity) return;
      const shown = !this.hidden.delete(severity as Severity);
      if (shown) this.hidden.add(severity as Severity);
      this.render();
      this.element.querySelector<HTMLElement>(`[data-severity="${severity}"]`)?.focus();
    });
    this.render();
  }

  /** A new model: nothing is known about it until the host validates it. */
  reset(): void {
    this.state = { kind: 'waiting' };
    this.render();
  }

  /**
   * The host's word on the validation. While a changed file is validated again, the last report
   * stays, marked as being checked again.
   */
  set(message: ValidationMessage): void {
    switch (message.state) {
      case 'running':
        this.state = {
          kind: 'running',
          previous: this.state.kind === 'done' ? this.state.report : undefined,
        };
        break;
      case 'done':
        this.state = { kind: 'done', report: message.report };
        break;
      case 'tooLarge':
        this.state = { kind: 'tooLarge', bytes: message.bytes };
        break;
      case 'failed':
        this.state = { kind: 'failed' };
        break;
    }
    this.render();
  }

  /** The report shown, if there is one. */
  get report(): ValidationReport | undefined {
    const { state } = this;
    return state.kind === 'done'
      ? state.report
      : state.kind === 'running'
        ? state.previous
        : undefined;
  }

  private render(): void {
    const { strings, state } = this;
    const status =
      state.kind === 'waiting'
        ? strings.waiting
        : state.kind === 'running'
          ? strings.running
          : state.kind === 'tooLarge'
            ? fill(strings.tooLarge, this.format.bytes(state.bytes))
            : state.kind === 'failed'
              ? strings.failed
              : fill(strings.validator, state.report.validator);
    const line = element('p', 'nm-note-line', status);
    line.setAttribute('role', 'status');
    const report = this.report;
    if (!report) {
      this.element.replaceChildren(line);
      return;
    }
    const parts: HTMLElement[] = [line, this.filters(report)];
    if (report.issues.length === 0) {
      const clean = element('p', 'nm-validation-clean', '');
      clean.innerHTML = icons.check;
      clean.append(document.createTextNode(strings.noIssues));
      parts.push(clean);
    } else {
      parts.push(this.list(report));
    }
    if (report.truncated) {
      parts.push(
        element(
          'p',
          'nm-note-line',
          fill(strings.truncated, this.format.count(report.issues.length)),
        ),
      );
    }
    this.element.replaceChildren(...parts);
  }

  private filters(report: ValidationReport): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'nm-filters';
    for (const severity of SEVERITIES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `nm-filter nm-severity-${severity}`;
      button.dataset.severity = severity;
      button.setAttribute('aria-pressed', String(!this.hidden.has(severity)));
      button.innerHTML = ICONS[severity];
      const count = this.format.count(report.counts[severity]);
      const label = `${this.strings.severities[severity]}: ${count}`;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.append(element('span', 'nm-mono', count));
      bar.append(button);
    }
    return bar;
  }

  private list(report: ValidationReport): HTMLElement {
    const list = document.createElement('ul');
    list.className = 'nm-issues';
    for (const issue of report.issues) {
      if (this.hidden.has(issue.severity)) continue;
      const item = document.createElement('li');
      item.className = `nm-issue nm-severity-${issue.severity}`;
      const icon = element('span', 'nm-issue-icon', '');
      icon.innerHTML = ICONS[issue.severity];
      icon.setAttribute('role', 'img');
      icon.setAttribute('aria-label', this.strings.severity[issue.severity]);
      const message = element('div', 'nm-issue-message', issue.message);
      const where = element('div', 'nm-issue-where', '');
      where.append(element('span', 'nm-mono', issue.code));
      if (issue.pointer !== undefined) {
        const key = this.links.entryAt(issue.pointer);
        const pointer = issue.pointer || '/';
        const location =
          key === undefined ? element('span', 'nm-mono', '') : this.link(pointer, key);
        if (key === undefined) location.append(...breakable(pointer));
        where.append(location);
      } else if (issue.offset !== undefined) {
        where.append(element('span', 'nm-mono', fill(this.strings.offset, issue.offset)));
      }
      item.append(icon, message, where);
      list.append(item);
    }
    return list;
  }

  private link(pointer: string, key: EntryKey): HTMLElement {
    const button = element('button', 'nm-link nm-mono', '');
    button.append(...breakable(pointer));
    button.setAttribute('type', 'button');
    button.dataset.key = key;
    const description = this.links.describe(key);
    if (description) button.title = description;
    return button;
  }
}

function element(tag: string, className: string, text: string): HTMLElement {
  const created = document.createElement(tag);
  if (className) created.className = className;
  created.textContent = text;
  return created;
}

/** A JSON pointer that a narrow panel wraps after its slashes, not in the middle of a name. */
function breakable(pointer: string): Node[] {
  return pointer
    .split('/')
    .flatMap((token, index) =>
      index === 0
        ? [document.createTextNode(token)]
        : [document.createElement('wbr'), document.createTextNode(`/${token}`)],
    );
}
