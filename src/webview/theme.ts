import type { HelperColors } from './scene/helpers';

/**
 * The viewport's background as sRGB channels from 0 to 1. It comes from CSS (`--nm-viewport`,
 * the editor background, a shade darker in light themes so white models stand out).
 */
export function viewportBackground(element: HTMLElement): [number, number, number] {
  return channels(getComputedStyle(element).backgroundColor);
}

/** The color the selection is drawn in: the theme's focus border, as sRGB channels from 0 to 1. */
export function highlightColor(): [number, number, number] {
  return probe('var(--vscode-focusBorder, #0078d4)', document.body);
}

/** The grid in the theme's text color, the axes in the colors the view's labels use. */
export function helperColors(viewport: HTMLElement): HelperColors {
  return {
    grid: probe('var(--vscode-foreground, #cccccc)', viewport),
    x: probe('var(--nm-axis-x)', viewport),
    y: probe('var(--nm-axis-y)', viewport),
    z: probe('var(--nm-axis-z)', viewport),
  };
}

/** What a CSS color comes to inside `parent`, as sRGB channels from 0 to 1. */
function probe(color: string, parent: HTMLElement): [number, number, number] {
  const element = document.createElement('span');
  element.style.color = color;
  parent.append(element);
  const computed = getComputedStyle(element).color;
  element.remove();
  return channels(computed);
}

function channels(color: string): [number, number, number] {
  const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(color);
  if (rgb) return [+rgb[1] / 255, +rgb[2] / 255, +rgb[3] / 255];
  // color-mix() computes to color(srgb r g b) with channels from 0 to 1.
  const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(color);
  if (srgb) return [+srgb[1], +srgb[2], +srgb[3]];
  return [0, 0, 0];
}

/** Calls `onChange` when VS Code switches the color theme: body classes and CSS variables. */
export function watchTheme(onChange: () => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 50);
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'data-vscode-theme-kind'],
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
}
