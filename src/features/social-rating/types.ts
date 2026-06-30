export interface RatingData {
  login: string;
  score: number;
  swag_score: number;
  social_score: number;
  isLowRating: boolean;
  enabled?: boolean;
}

export interface ActiveBadgeGrant {
  login: string;
  kind: 'high' | 'low';
  rank: number;
  image_url: string | null;
  title: string;
  period_label: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AliasEntry {
  login: string;
  alias: string;
}

export type AliasMap = Record<string, string>;

export interface ChannelPermissions {
  channel_login: string;
  role: 'owner' | 'moderator' | 'global_admin' | null;
  can_manage_moderators: boolean;
  can_adjust_rating: boolean;
  allowed_modes: Array<'delta' | 'set'>;
}

export interface ChannelRoleItem {
  login: string;
  role: 'owner' | 'moderator';
}
