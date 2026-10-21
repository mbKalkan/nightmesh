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
  warning: svg('<path d="M8 2 14.5 13.5h-13z"/><path d="M8 6.5v3.5M8 11.75v.25"/>'),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  // Validation issues, by severity, as VS Code's Problems panel marks them.
  issueError: svg(
    '<circle cx="8" cy="8" r="6"/><path d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5"/>',
  ),
  issueWarning: svg('<path d="M8 2 14.5 13.5h-13z"/><path d="M8 6.5v3.5M8 11.75v.25"/>'),
  issueInfo: svg('<circle cx="8" cy="8" r="6"/><path d="M8 7.25v4M8 4.75v.25"/>'),
  issueHint: svg(
    '<path d="M6.25 12.5h3.5"/><path d="M6 10.75C5.25 10 4.5 9 4.5 7.5a3.5 3.5 0 0 1 7 0c0 1.5-.75 2.5-1.5 3.25z"/>',
  ),
  json: svg(
    '<path d="M5.5 2.5H5A1.5 1.5 0 0 0 3.5 4v2.25L2 8l1.5 1.75V12A1.5 1.5 0 0 0 5 13.5h.5M10.5 2.5h.5A1.5 1.5 0 0 1 12.5 4v2.25L14 8l-1.5 1.75V12a1.5 1.5 0 0 1-1.5 1.5h-.5"/>',
  ),
  export: svg('<path d="M8 2.5v8M4.75 7.25 8 10.5l3.25-3.25"/><path d="M2.5 11v2.5h11V11"/>'),
  copy: svg(
    '<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
  ),
  check: svg('<circle cx="8" cy="8" r="6"/><path d="M5.25 8.25l1.75 1.75 3.75-4"/>'),
  chevron: svg('<path d="M6 4l4 4-4 4"/>'),
  play: svg('<path d="M5 3.5v9l7.5-4.5z" fill="currentColor"/>'),
  pause: svg('<path d="M5.5 3.5v9M10.5 3.5v9" stroke-width="2"/>'),
  shading: svg(
    '<circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor" stroke="none"/>',
  ),
  view: svg(
    '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  ),
  chevronDown: `<svg width="10" height="16" viewBox="0 0 10 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6.5 5 9.5l3-3"/></svg>`,
  ruler: svg(
    '<path d="M1.75 11.25 11.25 1.75l3 3-9.5 9.5z"/><path d="M4.25 8.75l1.5 1.5M6.25 6.75l1 1M8.25 4.75l1.5 1.5M10.25 2.75l1 1"/>',
  ),
  frame: svg(
    '<path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3"/><circle cx="8" cy="8" r="2"/>',
  ),
  panelLeft: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M6 2.5v11"/>'),
  panelRight: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M10 2.5v11"/>'),
  // Structure tree entries.
  scene: svg('<path d="M8 2.5l6 3-6 3-6-3z"/><path d="M2 8.5l6 3 6-3"/><path d="M2 11l6 3 6-3"/>'),
  node: svg('<circle cx="8" cy="8" r="2.25"/><path d="M8 1.5v3.5M8 11v3.5M1.5 8H5M11 8h3.5"/>'),
  mesh: svg('<path d="M8 2 14 13H2z"/><path d="M5 7.5h6M8 13 5 7.5M8 13l3-5.5"/>'),
  material: svg('<circle cx="8" cy="8" r="5.75"/><path d="M5 6.75A3.25 3.25 0 0 1 8 4.5"/>'),
  texture: svg(
    '<rect x="2" y="2" width="12" height="12" rx="1.5"/><circle cx="5.75" cy="5.75" r="1.25"/><path d="M2 11.5 6.5 7.5l3.25 3 1.75-1.5L14 11"/>',
  ),
  animation: svg('<circle cx="8" cy="8" r="5.75"/><path d="M6.75 5.5v5L10.75 8z"/>'),
  skin: svg(
    '<path d="M5 11l6-6"/><circle cx="3.75" cy="12.25" r="1.5"/><circle cx="12.25" cy="3.75" r="1.5"/>',
  ),
  camera: svg('<rect x="1.5" y="4.5" width="9" height="7" rx="1"/><path d="M10.5 7l4-2v6l-4-2"/>'),
  light: svg(
    '<path d="M6 12.5h4M6.5 14.25h3"/><path d="M5.75 10.75C4.75 9.75 4 8.75 4 7.25a4 4 0 0 1 8 0c0 1.5-.75 2.5-1.75 3.5z"/>',
  ),
} as const;
