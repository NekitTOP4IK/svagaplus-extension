export interface Badge {
  image_url?: string | null;
  url?: string | null;
  title?: string | null;
  rank?: number | null;
  source?: 'tra' | 'tsr' | string;
}

export interface ViewerConfig {
  name_gradient?: string;
  name_color?: string;
  name_css?: string;
  name_preset_name?: string;
  font_preset_id?: string | number | null;
  service_badge_ids?: Array<string | number>;
  channel_badge_tier_id?: string | number | null;
}

export interface FontPreset {
  source?: string;
  google_fonts_url?: string;
  cdn_path?: string;
  font_family?: string;
  ascent_override?: number;
  descent_override?: number;
  line_gap_override?: number;
  size_adjust?: number;
  is_pixel_font?: boolean;
}

