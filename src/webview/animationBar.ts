import type { AnimationStrings, Motion } from '../shared/protocol';
import { icons } from './icons';

/** What the bar shows: the clips by name and length, and where playback is. */
export interface AnimationBarState {
  names: string[];
  durations: number[];
  clip: number;
  time: number;
  playing: boolean;
  speed: number;
}

export interface AnimationBarEvents {
  clip(index: number): void;
  playing(playing: boolean): void;
  seek(time: number): void;
  speed(speed: number): void;
}

const SPEEDS = [0.25, 0.5, 1, 2];

/**
 * The bar below the view for a model with animations: which clip, play and pause, a time line
 * to scrub, and the speed. Plain form controls, so the keyboard and screen readers know them.
 */
export class AnimationBar {
  readonly element: HTMLElement;
  private readonly clips: HTMLSelectElement;
  private readonly play: HTMLButtonElement;
  private readonly slider: HTMLInputElement;
  private readonly clock: HTMLElement;
  private readonly speeds: HTMLSelectElement;
  private readonly seconds: Intl.NumberFormat;
  private readonly note: HTMLElement;
  private readonly noteText: HTMLElement;
  private names: string[] = [];
  private motion: readonly (Motion | null)[] = [];
  private clip = 0;
  private playing = false;
  /** While the user drags the time line, playback doesn't move it under the pointer. */
  private scrubbing = false;

  /** `descriptions` say at length what each kind of motion means, in the note's tooltip. */
  constructor(
    private readonly strings: AnimationStrings,
    private readonly descriptions: Record<Motion, string>,
    locale: string,
    events: AnimationBarEvents,
  ) {
    this.seconds = numberFormat(locale, 2);
    this.element = document.createElement('div');
    this.element.className = 'nm-animation';
    this.element.hidden = true;
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', strings.bar);
    this.element.innerHTML = `
      <button class="nm-icon-button nm-play" type="button"></button>
      <select class="nm-select nm-clips"></select>
      <span class="nm-motion" hidden>${icons.warning}<span class="nm-motion-text"></span></span>
      <input class="nm-timeline" type="range" min="0" step="any" value="0" />
      <span class="nm-clock nm-mono"></span>
      <select class="nm-select nm-speeds"></select>`;
    const find = <T extends HTMLElement>(selector: string) =>
      this.element.querySelector(selector) as T;
    this.play = find('.nm-play');
    this.clips = find('.nm-clips');
    this.slider = find('.nm-timeline');
    this.clock = find('.nm-clock');
    this.speeds = find('.nm-speeds');
    this.note = find('.nm-motion');
    this.noteText = find('.nm-motion-text');

    this.clips.setAttribute('aria-label', strings.clip);
    this.clips.title = strings.clip;
    this.slider.setAttribute('aria-label', strings.time);
    this.speeds.setAttribute('aria-label', strings.speed);
    this.speeds.title = strings.speed;
    const speed = numberFormat(locale, 0);
    this.speeds.replaceChildren(
      ...SPEEDS.map((value) => new Option(`${speed.format(value)}×`, String(value))),
    );

    this.play.addEventListener('click', () => events.playing(!this.playing));
    this.clips.addEventListener('change', () => events.clip(Number(this.clips.value)));
    this.speeds.addEventListener('change', () => events.speed(Number(this.speeds.value)));
    this.slider.addEventListener('input', () => {
      this.scrubbing = true;
      events.seek(Number(this.slider.value));
    });
    this.slider.addEventListener('change', () => (this.scrubbing = false));
  }

  /**
   * Whether each clip moves anything, by index. Next to a picked clip that doesn't, a note says
   * so: playing it would otherwise look broken.
   */
  setMotion(motion: readonly (Motion | null)[]): void {
    this.motion = motion;
    this.showNote();
  }

  /** Shows playback as the view reports it; undefined hides the bar. */
  update(state: AnimationBarState | undefined): void {
    this.element.hidden = !state;
    if (!state) return;
    if (state.names.join('\n') !== this.names.join('\n')) {
      this.names = state.names;
      this.clips.replaceChildren(
        ...state.names.map((name, index) => new Option(name, String(index))),
      );
    }
    // Playback reports every frame. Only what changed is touched: a control rebuilt under the
    // pointer between press and release loses the click, and an open list would close.
    setIfChanged(this.clips, String(state.clip));
    this.clip = state.clip;
    this.showNote();
    setIfChanged(this.speeds, String(state.speed));
    if (state.playing !== this.playing || !this.play.firstChild) {
      this.playing = state.playing;
      const label = state.playing ? this.strings.pause : this.strings.play;
      this.play.innerHTML = state.playing ? icons.pause : icons.play;
      this.play.title = label;
      this.play.setAttribute('aria-label', label);
    }
    const duration = state.durations[state.clip] ?? 0;
    this.play.disabled = duration <= 0;
    this.slider.disabled = duration <= 0;
    if (this.slider.max !== String(duration)) this.slider.max = String(duration);
    if (!this.scrubbing) this.slider.value = String(state.time);
    this.clock.textContent = `${this.seconds.format(state.time)} / ${this.seconds.format(duration)} s`;
  }

  private showNote(): void {
    const motion = this.motion[this.clip];
    const still = motion === 'holds' || motion === 'none';
    this.note.hidden = !still;
    if (still && this.noteText.textContent !== this.strings.motion[motion]) {
      this.noteText.textContent = this.strings.motion[motion];
      this.note.title = this.descriptions[motion];
    }
  }
}

function setIfChanged(control: HTMLSelectElement, value: string): void {
  if (control.value !== value) control.value = value;
}

/** Numbers with exactly `fixed` decimals, or up to two when `fixed` is 0. */
function numberFormat(locale: string, fixed: number): Intl.NumberFormat {
  const options = { minimumFractionDigits: fixed, maximumFractionDigits: Math.max(fixed, 2) };
  try {
    return new Intl.NumberFormat(locale, options);
  } catch {
    return new Intl.NumberFormat('en', options);
  }
}
