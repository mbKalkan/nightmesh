// Inline 16px icons drawn with currentColor so they follow the VS Code theme.

const svg = (body: string) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  model: svg(
    '<path d="M8 1.5 13.5 4.5v7L8 14.5 2.5 11.5v-7z"/><path d="M2.5 4.5 8 7.5l5.5-3M8 7.5v7"/>',
  ),
  error: svg(
    '<path d="M8 1.5 13.5 4.5v7L8 14.5 2.5 11.5v-7z"/><path d="M6.25 6.25l3.5 3.5M9.75 6.25l-3.5 3.5"/>',
  ),
} as const;
