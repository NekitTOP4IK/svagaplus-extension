import type { FontPreset, ViewerConfig } from './types';

export class ChannelStyleCache {
  private readonly users = new Map<string, Record<string, ViewerConfig>>();
  private readonly fonts = new Map<string, Record<string, FontPreset>>();

  private normalize(value: string): string {
    return value.trim().toLowerCase();
  }

  replaceViewer(
    channel: string,
    login: string,
    viewer: Record<string, unknown> | null | undefined,
  ): void {
    const channelKey = this.normalize(channel);
    const loginKey = this.normalize(login);
    if (!channelKey || !loginKey) return;

    const users = this.users.get(channelKey) ?? {};
    const next: ViewerConfig = {};
    if (typeof viewer?.name_color === 'string') next.name_color = viewer.name_color;
    if (typeof viewer?.name_gradient === 'string') next.name_gradient = viewer.name_gradient;
    if (typeof viewer?.name_css === 'string') next.name_css = viewer.name_css;
    if (typeof viewer?.name_preset_name === 'string') next.name_preset_name = viewer.name_preset_name;
    if (typeof viewer?.font_preset_id === 'string' || typeof viewer?.font_preset_id === 'number') {
      next.font_preset_id = viewer.font_preset_id;
    }
    users[loginKey] = next;
    this.users.set(channelKey, users);
  }

  assignFontPresets(channel: string, presets: Record<string, FontPreset>): void {
    const channelKey = this.normalize(channel);
    if (!channelKey) return;
    const next = Object.fromEntries(
      Object.entries(presets).map(([presetId, preset]) => [presetId, { ...preset }]),
    );
    this.fonts.set(channelKey, { ...(this.fonts.get(channelKey) ?? {}), ...next });
  }

  usersFor(channel: string | null): Record<string, ViewerConfig> {
    const key = channel ? this.normalize(channel) : '';
    if (!key) return {};
    return Object.fromEntries(
      Object.entries(this.users.get(key) ?? {}).map(([login, viewer]) => [login, { ...viewer }]),
    );
  }

  fontPresetsFor(channel: string | null): Record<string, FontPreset> {
    const key = channel ? this.normalize(channel) : '';
    if (!key) return {};
    return Object.fromEntries(
      Object.entries(this.fonts.get(key) ?? {}).map(([presetId, preset]) => [presetId, { ...preset }]),
    );
  }

  clearChannel(channel: string): void {
    const key = this.normalize(channel);
    this.users.delete(key);
    this.fonts.delete(key);
  }

  clearViewerEverywhere(login: string): void {
    const key = this.normalize(login);
    for (const users of this.users.values()) delete users[key];
  }
}
