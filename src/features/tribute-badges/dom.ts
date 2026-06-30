import type { Badge, FontPreset, ViewerConfig } from './types';

export const tooltip = document.createElement('div');
tooltip.id = 'tcb-custom-tooltip';

export function normalizeLogin(value: string | null | undefined): string {
  return (value || '').toLowerCase().trim();
}

export function showTooltip(event: Event, text: string | null | undefined): void {
  if (!text) return;
  if (!tooltip.parentNode && document.body) document.body.appendChild(tooltip);
  tooltip.textContent = text;
  tooltip.style.display = 'block';

  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const left = Math.max(4, Math.min(window.innerWidth - tooltip.offsetWidth - 4, rect.left + rect.width / 2 - tooltip.offsetWidth / 2));
  const top = Math.max(4, rect.top - tooltip.offsetHeight - 7);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

export function hideTooltip(): void {
  tooltip.style.display = 'none';
}

export function createBadgeImg(badge: Badge): HTMLImageElement | null {
  const url = badge.image_url || badge.url;
  if (!url) return null;
  const img = document.createElement('img');
  img.src = url;
  img.className = 'tcb-badge-img';
  img.alt = badge.title || 'Badge';
  img.style.cssText = 'width:18px!important;height:18px!important;min-width:18px!important;min-height:18px!important;max-width:18px!important;max-height:18px!important;';
  img.addEventListener('mouseenter', (event) => showTooltip(event, badge.title));
  img.addEventListener('mouseleave', hideTooltip);
  img.addEventListener('wheel', hideTooltip);
  img.onerror = () => { img.style.display = 'none'; };
  return img;
}

export function dedupeBadges(badges: Badge[]): Badge[] {
  const seen = new Set<string>();
  const result: Badge[] = [];
  for (const badge of badges) {
    const key = `${badge.source || ''}|${badge.rank || ''}|${badge.image_url || badge.url || ''}|${badge.title || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(badge);
  }
  return result;
}

function buildNameCssCompat(config: ViewerConfig): string | null {
  if (config.name_gradient) {
    return `background: ${config.name_gradient}; -webkit-background-clip: text; -webkit-text-fill-color: transparent;`;
  }
  if (config.name_color) return `color: ${config.name_color};`;
  return null;
}

export function updateDynamicStyles(
  cachedUsers: Record<string, ViewerConfig>,
  fontPresets: Record<string, FontPreset>,
  backendUrl: string,
): void {
  let styleEl = document.getElementById('tcb-dynamic-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'tcb-dynamic-styles';
    document.head.appendChild(styleEl);
  }

  const usedFontIds = new Set<string>();
  for (const config of Object.values(cachedUsers)) {
    if (config.font_preset_id != null) usedFontIds.add(String(config.font_preset_id));
  }

  let fontCss = '';
  const base = backendUrl.replace(/\/$/, '');
  for (const fontId of usedFontIds) {
    const preset = fontPresets[fontId];
    if (!preset) continue;
    if (preset.source === 'google' && preset.google_fonts_url) {
      fontCss += `@import url('${preset.google_fonts_url}');\n`;
    } else if (preset.source === 'cdn' && preset.cdn_path && preset.font_family) {
      const overrides = [];
      if (preset.ascent_override != null) overrides.push(`ascent-override: ${preset.ascent_override}%`);
      if (preset.descent_override != null) overrides.push(`descent-override: ${preset.descent_override}%`);
      if (preset.line_gap_override != null) overrides.push(`line-gap-override: ${preset.line_gap_override}%`);
      if (preset.size_adjust != null) overrides.push(`size-adjust: ${preset.size_adjust}%`);
      const overrideStr = overrides.length ? `; ${overrides.join('; ')}` : '';
      fontCss += `@font-face { font-family: '${preset.font_family}'; src: url('${base}${preset.cdn_path}') format('woff2')${overrideStr}; }\n`;
    }
  }

  let css = `${fontCss}
    .tcb-badge-img {
      cursor: pointer;
      pointer-events: auto !important;
    }
  `;

  for (const [username, config] of Object.entries(cachedUsers)) {
    const safeName = username.replace(/(["\\])/g, '\\$1');
    const nativeSel = `.chat-line__message:not(:has(.seventv-chat-user)) [data-tcb-user="${safeName}"].chat-author__display-name:not([data-tcb-paint])`;
    const stvNameSel = `[data-tcb-user="${safeName}"] .seventv-chat-user-username:not([style*="background"])`;
    const nameCss = config.name_css || buildNameCssCompat(config);
    if (!nameCss) continue;

    const declarations = nameCss.split(';').filter(Boolean).map((item) => item.trim());
    const important = declarations.map((item) => `${item} !important`).join('; ') + ';';
    const importantNoFilter = declarations
      .filter((item) => !item.toLowerCase().startsWith('filter'))
      .map((item) => `${item} !important`)
      .join('; ') + ';';
    const filterDecls = declarations
      .filter((item) => item.toLowerCase().startsWith('filter'))
      .map((item) => `${item} !important`)
      .join('; ');

    css += `${nativeSel} { ${important} }\n`;
    css += `${stvNameSel} { ${importantNoFilter} }\n`;
    if (filterDecls) {
      css += `[data-tcb-user="${safeName}"] .seventv-chat-user-username:not([style*="background"]):not(:has(.seventv-paint)) { ${filterDecls}; }\n`;
    }

    const preset = config.font_preset_id != null ? fontPresets[String(config.font_preset_id)] : null;
    if (preset?.is_pixel_font) {
      const pixelCss = '-webkit-font-smoothing: none !important; -moz-osx-font-smoothing: unset !important; text-rendering: optimizeSpeed !important;';
      css += `${nativeSel} { ${pixelCss} }\n`;
      css += `${stvNameSel} { ${pixelCss} }\n`;
    }
  }

  styleEl.textContent = css;
}
