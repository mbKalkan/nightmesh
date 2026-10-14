/** The narrowest a side panel gets. */
const MIN_WIDTH = 160;
/** The least room a side panel leaves the viewport. */
const MIN_VIEWPORT = 160;
/** One arrow key press on a sash. */
const KEY_STEP = 20;

/**
 * A panel beside the viewport, like VS Code's side bars: a small uppercase title, a body, and a
 * sash on the inner edge that resizes it by mouse or arrow keys.
 */
export class SidePanel {
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sash: HTMLElement;

  constructor(
    private readonly side: 'left' | 'right',
    width: number,
    private readonly onResized: (width: number) => void,
  ) {
    this.element = document.createElement('aside');
    this.element.className = `nm-panel nm-panel-${side}`;
    this.element.hidden = true;
    this.element.style.flexBasis = `${width}px`;
    this.element.innerHTML = `
      <div class="nm-sash" role="separator" aria-orientation="vertical" tabindex="0"></div>
      <h2 class="nm-panel-title"></h2>
      <div class="nm-panel-body"></div>`;
    this.title = this.element.querySelector('.nm-panel-title') as HTMLElement;
    this.body = this.element.querySelector('.nm-panel-body') as HTMLElement;
    this.sash = this.element.querySelector('.nm-sash') as HTMLElement;
    this.setUpSash();
  }

  setLabels(title: string, sashLabel: string): void {
    this.title.textContent = title;
    this.element.setAttribute('aria-label', title);
    this.sash.setAttribute('aria-label', sashLabel);
  }

  get width(): number {
    return Math.round(this.element.getBoundingClientRect().width);
  }

  private setUpSash(): void {
    // Dragging toward the viewport widens a panel: right for the left one, left for the right one.
    const direction = this.side === 'left' ? 1 : -1;
    this.sash.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.sash.setPointerCapture(event.pointerId);
      this.sash.classList.add('nm-active');
      const startX = event.clientX;
      const startWidth = this.element.getBoundingClientRect().width;
      const move = (moved: PointerEvent) =>
        this.resize(startWidth + (moved.clientX - startX) * direction);
      const end = () => {
        this.sash.classList.remove('nm-active');
        this.sash.removeEventListener('pointermove', move);
        this.sash.removeEventListener('pointerup', end);
        this.sash.removeEventListener('pointercancel', end);
        this.onResized(this.width);
      };
      this.sash.addEventListener('pointermove', move);
      this.sash.addEventListener('pointerup', end);
      this.sash.addEventListener('pointercancel', end);
    });
    this.sash.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const wider = (event.key === 'ArrowRight') === (this.side === 'left');
      this.resize(this.width + (wider ? KEY_STEP : -KEY_STEP));
      this.onResized(this.width);
    });
  }

  /** Widens or narrows the panel, leaving the viewport and the other panel room. */
  private resize(width: number): void {
    const body = this.element.parentElement;
    let room = Infinity;
    if (body) {
      const others = [...body.children]
        .filter((child) => child !== this.element && child.classList.contains('nm-panel'))
        .reduce((sum, child) => sum + child.getBoundingClientRect().width, 0);
      room = body.getBoundingClientRect().width - others - MIN_VIEWPORT;
    }
    const clamped = Math.max(MIN_WIDTH, Math.min(width, room));
    this.element.style.flexBasis = `${Math.round(clamped)}px`;
  }
}
