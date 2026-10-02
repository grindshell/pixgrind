/** 16×16 stroke icons, drawn in `currentColor`. */
const ICONS = {
  plus: '<path d="M8 3v10M3 8h10"/>',
  duplicate: '<rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1"/><path d="M3 10.5V4a1 1 0 0 1 1-1h6.5"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5"/>',
  arrowUp: '<path d="M8 13V3M4 7l4-4 4 4"/>',
  arrowDown: '<path d="M8 3v10M4 9l4 4 4-4"/>',
  mergeDown: '<path d="M3 3.5h10M8 6v7M5 10l3 3 3-3"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  eyeOff: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM2.5 2.5l11 11"/>',
  pencil: '<path d="M10.5 2.5l3 3-8 8h-3v-3zM8.5 4.5l3 3"/>',
  eraser: '<path d="M9.5 2.5l4 4-6.5 6.5H4.5l-2-2zM6 6l4 4M7.5 13.5h6"/>',
  line: '<path d="M3 13L13 3"/>',
  rect: '<rect x="2.5" y="3.5" width="11" height="9" rx="0.5"/>',
  rectFilled: '<rect x="2.5" y="3.5" width="11" height="9" rx="0.5" fill="currentColor"/>',
  fill: '<path d="M7.5 2.5l5 5-5 5-5-5zM2.5 7.5h10M14 11s1 1.4 1 2.1a1 1 0 0 1-2 0c0-.7 1-2.1 1-2.1z"/>',
  select: '<rect x="2.5" y="2.5" width="11" height="11" stroke-dasharray="2 2"/>',
  lasso:
    '<path d="M5 11.2C2.6 10.6 1.5 8.8 2.3 6.8 3.4 4 7.8 2.6 11.3 3.5c2.8.7 3.6 3 2.2 4.9-1.4 1.9-5 2.9-8.5 2.8"/><path d="M5 11.2c-.8.9-.6 2.4.8 3.1"/>',
  wand: '<path d="M2.5 13.5l7-7M11.5 1.5v4M9.5 3.5h4M5 2.5v2M4 3.5h2M13 8.5v2M12 9.5h2"/>',
  selectReplace: '<rect x="3" y="3" width="10" height="10" fill="currentColor" fill-opacity=".35"/>',
  selectAdd: '<path d="M2 2h8v4h4v8H6v-4H2z" fill="currentColor" fill-opacity=".35"/>',
  selectSubtract:
    '<path d="M2 2h8v4H6v4H2z" fill="currentColor" fill-opacity=".35"/><path d="M6 6h8v8H6z" stroke-dasharray="1.5 1.5"/>',
  selectIntersect:
    '<path d="M2 2h8v8H2zM6 6h8v8H6z" stroke-dasharray="1.5 1.5"/><path d="M6 6h4v4H6z" fill="currentColor"/>',
  move: '<path d="M8 1.5v13M1.5 8h13M6 3.5l2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2"/>',
  image: '<rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="6.5" r="1"/><path d="M2.5 12l4-4 3 3 2-2 2.5 2.5"/>',
  swap: '<path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13"/>',
  brushRound: '<circle cx="8" cy="8" r="5" fill="currentColor"/>',
  brushSquare: '<rect x="3" y="3" width="10" height="10" fill="currentColor"/>',
  eyedropper:
    '<path d="M10.5 3a1.6 1.6 0 0 1 2.5 2.5l-1.5 1.5-2.5-2.5zM9.5 5l-6 6-.5 2 2-.5 6-6M8.5 4l3.5 3.5"/>',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}
