export interface ViewportHandlers {
  /** The GPU dropped the context; drawing resumes by itself if it comes back. */
  onContextLost(): void;
  onContextRestored(): void;
}

/** The drawing surface: a WebGL 2 canvas that fills its container and follows the theme. */
export class Viewport {
  private readonly resizeObserver: ResizeObserver;
  private lost = false;

  /** Returns undefined when WebGL 2 isn't available, for example with the GPU turned off. */
  static create(container: HTMLElement, handlers: ViewportHandlers): Viewport | undefined {
    const canvas = document.createElement('canvas');
    canvas.className = 'nm-canvas';
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true });
    if (!gl) {
      return undefined;
    }
    container.prepend(canvas);
    return new Viewport(container, canvas, gl, handlers);
  }

  private constructor(
    private readonly container: HTMLElement,
    readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    handlers: ViewportHandlers,
  ) {
    canvas.addEventListener('webglcontextlost', (event) => {
      // Without preventDefault the browser never offers the context back.
      event.preventDefault();
      this.lost = true;
      handlers.onContextLost();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      handlers.onContextRestored();
      this.render();
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** Draws a frame; the scene is empty for now, so this clears to the theme's background. */
  render(): void {
    if (this.lost) {
      return;
    }
    const [r, g, b] = themeBackground();
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.clearColor(r, g, b, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.canvas.remove();
  }

  private resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(this.container.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.container.clientHeight * ratio));
    if (width !== this.canvas.width || height !== this.canvas.height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.render();
  }
}

/** The page background VS Code's theme sets, as 0–1 channels for WebGL. */
function themeBackground(): [number, number, number] {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(
    getComputedStyle(document.body).backgroundColor,
  );
  return match ? [+match[1] / 255, +match[2] / 255, +match[3] / 255] : [0, 0, 0];
}
