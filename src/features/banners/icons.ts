import type { BannerType } from './model';

const SVG_NS = 'http://www.w3.org/2000/svg';

export type IconKind = BannerType | 'offline';

const PATHS: Record<IconKind, string> = {
  info: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0 M12 9h.01 M11 12h1v4h1',
  tip: 'M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7 M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3 M9.7 17l4.6 0',
  announcement:
    'M18 8a3 3 0 0 1 0 6 M10 8v11a1 1 0 0 1 -1 1h-1a1 1 0 0 1 -1 -1v-5 M12 8h0l4.524 -3.77a.9 .9 0 0 1 1.476 .692v12.156a.9 .9 0 0 1 -1.476 .692l-4.524 -3.77h-8a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h8',
  success: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M9 12l2 2l4 -4',
  warning:
    'M12 9v4 M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z M12 16h.01',
  danger:
    'M12.802 2.165l5.575 2.389c.48 .206 .863 .589 1.07 1.07l2.388 5.574c.22 .512 .22 1.092 0 1.604l-2.389 5.575c-.206 .48 -.589 .863 -1.07 1.07l-5.574 2.388c-.512 .22 -1.092 .22 -1.604 0l-5.575 -2.389a2.036 2.036 0 0 1 -1.07 -1.07l-2.388 -5.574a2.036 2.036 0 0 1 0 -1.604l2.389 -5.575c.206 -.48 .589 -.863 1.07 -1.07l5.574 -2.388a2.036 2.036 0 0 1 1.604 0z M12 8v4 M12 16h.01',
  maintenance: 'M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5',
  offline:
    'M12 18l.01 0 M9.172 15.172a4 4 0 0 1 5.656 0 M6.343 12.343a7.963 7.963 0 0 1 3.864 -2.14m4.163 .155a7.965 7.965 0 0 1 3.287 2 M3.515 9.515a12 12 0 0 1 3.544 -2.455m3.101 -.92a12 12 0 0 1 10.325 3.374 M3 3l18 18',
};

export function iconSvg(kind: IconKind, label: string | null): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'svp-notice__icon');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (label === null) {
    svg.setAttribute('aria-hidden', 'true');
  } else {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  }
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', PATHS[kind]);
  svg.append(path);
  return svg;
}
