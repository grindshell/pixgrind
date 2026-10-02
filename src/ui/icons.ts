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
