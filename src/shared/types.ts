export interface ExtensionSettings {
  socialRatingEnabled: boolean;
}

export interface ViewerAccount {
  token: string;
  twitchLogin: string;
  avatarUrl: string | null;
  telegramLinked: boolean;
  lastCheckedAt: number;
}

export interface RuntimeChannelState {
  channelLogin: string | null;
  ratingEnabledForChannel: boolean | null;
  lastUpdatedAt: number;
}

export interface V3Badge {
  id: string;
  source: 'tra' | 'tsr';
  title: string;
  url: string | null;
  kind: string | null;
  rank: number | null;
  periodId: string | null;
  active: boolean;
}

export interface V3ViewerBadges {
  viewer: {
    id: string | null;
    login: string;
    twitchId: string | null;
  };
  badges: V3Badge[];
  traBadges: V3Badge[];
  tsrBadges: V3Badge[];
}

export interface SocialRating {
  channelLogin: string;
  viewerLogin: string;
  swagScore: number;
  socialScore: number;
  enabled: boolean;
}

export interface SocialChannelStatus {
  channelLogin: string;
  ratingEnabled: boolean;
  activityPublic: boolean;
}
