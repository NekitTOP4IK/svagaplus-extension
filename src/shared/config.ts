declare const __BACKEND_URL__: string;
declare const __FRONTEND_URL__: string;

export const BACKEND_URL = __BACKEND_URL__.replace(/\/+$/, '');
export const FRONTEND_URL = __FRONTEND_URL__.replace(/\/+$/, '');

export const VIEWER_AUTH_REDIRECT_PATH = 'viewer-auth';
