declare const __BACKEND_URL__: string;
declare const __FRONTEND_URL__: string;
declare const __BUILD_CHANNEL__: 'prod' | 'staging';

export const BACKEND_URL = __BACKEND_URL__.replace(/\/+$/, '');
export const FRONTEND_URL = __FRONTEND_URL__.replace(/\/+$/, '');

/** Канал, в котором собран этот бандл. Пишется webpack'ом, дублируется в build-info.json. */
export const BUILD_CHANNEL: 'prod' | 'staging' = __BUILD_CHANNEL__;

export const VIEWER_AUTH_REDIRECT_PATH = 'viewer-auth';
