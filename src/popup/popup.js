/**
 * Tribute Alerts — Popup Script
 * Flow: Twitch cookie → is_linked? → Telegram bot deeplink → polling → ✅ linked
 */

(function () {
  'use strict';

  const BACKEND_URL = '__BACKEND_URL__';

  const $ = (id) => document.getElementById(id);

  function showInfoState(icon, title, desc, showStatus = false) {
    showState('stateNotOnTwitch');
    const el = $('stateNotOnTwitch');
    if (!el) return;
    el.querySelector('.info-icon').textContent = icon;
    el.querySelector('.info-title').textContent = title;
    el.querySelector('.info-desc').textContent = desc;
    const statusLink = $('infoStatusLink');
    if (statusLink) statusLink.classList.toggle('visible', showStatus);
  }

  function showState(name) {
    const allStates = [
      'stateLoading', 'stateNotOnTwitch', 'stateNotLoggedIn',
      'stateUnlinked', 'statePolling',
      'stateLinked', 'stateLinkedNoSub'
    ];
    allStates.forEach(s => {
      const el = $(s);
      if (el) el.classList.toggle('active', s === name);
    });
  }

  function getActiveTabInfo() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) return resolve(null);
        const tab = tabs[0];
        if (!tab.url || !tab.url.includes('twitch.tv')) return resolve(null);

        chrome.tabs.sendMessage(tab.id, { type: 'GET_LOGIN' }, (response) => {
          if (chrome.runtime.lastError || !response) {
            resolve(null);
          } else {
            resolve(response);
          }
        });
      });
    });
  }

  const STATUS_CACHE_TTL = 30_000;

  async function fetchStatus(channel, login, { bypassCache = false } = {}) {
    const cacheKey = `status_${channel}_${login}`;

    if (!bypassCache) {
      try {
        const stored = await chrome.storage.session.get(cacheKey);
        const entry = stored[cacheKey];
        if (entry && Date.now() - entry.ts < STATUS_CACHE_TTL) {
          return entry.data;
        }
      } catch { /* storage unavailable */ }
    }

    const res = await fetch(`${BACKEND_URL}/api/v2/badges/${channel}/status/${login}`, {
      signal: AbortSignal.timeout(8000)
    });
    const data = await res.json();

    try {
      await chrome.storage.session.set({ [cacheKey]: { ts: Date.now(), data } });
    } catch { /* ignore */ }

    return data;
  }

  const VERSION_CHECK_TTL = 60 * 60 * 1000;

  function _isNewer(latest, current) {
    const parse = (v) => (v || '0').split('.').map(Number);
    const [lM, lm, lp] = parse(latest);
    const [cM, cm, cp] = parse(current);
    if (lM !== cM) return lM > cM;
    if (lm !== cm) return lm > cm;
    return lp > cp;
  }

  async function fetchExtensionInfo() {
    const cached = await chrome.storage.session.get('ext_version_info');
    const entry = cached.ext_version_info;
    if (entry && Date.now() - entry.ts < VERSION_CHECK_TTL) return entry.data;
    const res = await fetch(`${BACKEND_URL}/api/extension/info`, { signal: AbortSignal.timeout(5000) });
    const info = await res.json();
    await chrome.storage.session.set({ ext_version_info: { ts: Date.now(), data: info } });
    return info;
  }

  async function checkAndShowUpdateBanner() {
    try {
      const dismissed = await chrome.storage.session.get('update_banner_dismissed');
      if (dismissed.update_banner_dismissed) return null;

      const info = await fetchExtensionInfo();
      if (!info) return null;

      const current = chrome.runtime.getManifest().version;
      const latestVersion = info.store_version || info.zip_version || info.version;
      const hasUpdate = _isNewer(latestVersion, current);
      if (!hasUpdate) return info;

      const banner = $('updateBanner');
      const textEl = $('updateBannerText');
      const linkEl = $('updateBannerLink');
      const closeBtn = $('updateBannerDismiss');
      if (!banner) return;

      const resolveUrl = (url) => url && !url.startsWith('http') ? BACKEND_URL + url : (url || '#');

      if (textEl) textEl.textContent = `Доступна новая версия: ${latestVersion}`;
      if (linkEl) { linkEl.href = resolveUrl(info.store_url_new || info.store_url || info.download_url); linkEl.textContent = (info.store_url_new || info.store_url) ? 'Обновить' : 'Скачать'; }

      banner.style.display = 'flex';

      if (closeBtn) {
        closeBtn.onclick = async () => {
          banner.style.display = 'none';
          await chrome.storage.session.set({ update_banner_dismissed: true });
        };
      }
      return info;
    } catch { /* ignore — don't block main flow */ }
    return null;
  }

  let pollingInterval = null;
  let pollingLogin = null;
  let pollingChannel = null;

  function startPolling(login, channel) {
    stopPolling();
    pollingLogin = login;
    pollingChannel = channel;
    showState('statePolling');

    let ticks = 0;
    const MAX_TICKS = 45;

    async function tick() {
      ticks++;
      if (ticks > MAX_TICKS) {
        stopPolling();
        showUnlinked(login, channel);
        return;
      }
      try {
        const result = await fetchStatus(channel, login, { bypassCache: true });
        if (result.success && result.data && result.data.is_linked) {
          stopPolling();
          await renderLinkedState(login, channel, result.data);
        }
      } catch { /* keep polling */ }
    }

    tick();
    pollingInterval = setInterval(tick, 2000);
  }

  function stopPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  function showUnlinked(login, channel) {
    showState('stateUnlinked');
    const btn = $('linkBtn');
    if (btn) {
      btn.onclick = () => {
        chrome.tabs.create({ url: `${BACKEND_URL}/viewer-connect` });
        startPolling(login, channel);
      };
    }
  }

  async function renderLinkedState(login, channel, data) {
    const isOwner = channel && login && channel.toLowerCase() === login.toLowerCase();
    const isSubscriber = data.is_subscriber || isOwner;
    const viewerUsername = data.viewer_username || login;
    const viewerAvatar = data.viewer_avatar;
    const subDuration = data.sub_duration;
    const subStreak = data.sub_streak;
    const subscriptionLink = data.subscription_link;

    if (isSubscriber) {
      showState('stateLinked');

      const nameEl = $('userName');
      const avatarEl = $('userAvatar');
      const channelEl = $('channelName');
      const subEl = $('subStatus');

      if (nameEl) nameEl.textContent = viewerUsername;
      if (avatarEl && viewerAvatar) avatarEl.src = viewerAvatar;
      if (channelEl) channelEl.textContent = channel;
      if (subEl) subEl.textContent = isOwner
        ? '👑 Да это же ваш канал!'
        : (subDuration ? `${subDuration} мес.${subStreak > 1 ? ` (${subStreak} подряд)` : ''}` : 'Активна');

      const colorRow = $('colorRow');
      const colorPreview = $('colorNamePreview');
      const colorLink = $('colorCustomizeLink');
      if (colorRow && !isOwner) {
        colorRow.style.display = 'block';
        const nameCss = data.name_css || null;
        const nameColor = data.name_color || null;
        if (colorPreview) {
          colorPreview.textContent = viewerUsername;
          if (nameCss) {
            colorPreview.style.cssText = nameCss;
          } else if (nameColor) {
            colorPreview.style.cssText = `color: ${nameColor};`;
          } else {
            colorPreview.style.cssText = 'color: #efeff1;';
          }
        }
        if (colorLink) {
          colorLink.href = `${BACKEND_URL}/viewer/settings`;
        }
      } else if (colorRow) {
        colorRow.style.display = 'none';
      }

      const settingsLink = $('settingsLink');
      if (settingsLink) settingsLink.href = `${BACKEND_URL}/viewer/settings`;
    } else {
      showState('stateLinkedNoSub');

      const nameEl2 = $('userName2');
      const avatarEl2 = $('userAvatar2');
      const subDescEl = $('subDesc');
      const subLinkBtn = $('subLinkBtn');

      if (nameEl2) nameEl2.textContent = viewerUsername;
      if (avatarEl2 && viewerAvatar) avatarEl2.src = viewerAvatar;
      if (subDescEl) subDescEl.textContent = `Оформите подписку на канал ${channel}, чтобы получить значок подписчика!`;

      if (subscriptionLink && subLinkBtn) {
        subLinkBtn.style.display = 'flex';
        subLinkBtn.onclick = () => chrome.tabs.create({ url: subscriptionLink });
      }

      const settingsLink2 = $('settingsLink2');
      if (settingsLink2) settingsLink2.href = `${BACKEND_URL}/viewer/settings`;
    }
  }

  async function renderState() {
    showState('stateLoading');

    let tabInfo;
    try {
      tabInfo = await getActiveTabInfo();
    } catch {
      tabInfo = null;
    }

    if (!tabInfo) {
      showInfoState('🎮', 'Откройте канал на Twitch', 'Перейдите на страницу стримера, чтобы расширение заработало.');
      return;
    }

    const { login, channel } = tabInfo;

    if (!login) {
      showState('stateNotLoggedIn');
      return;
    }

    if (!channel) {
      showInfoState('🎮', 'Откройте страницу канала', 'Перейдите на страницу стримера, чтобы расширение заработало (возможно, вам нужно просто нажать F5).');
      return;
    }

    try {
      const result = await fetchStatus(channel, login);

      if (!result.success) {
        showInfoState('⚠️', 'Ошибка сервера', 'Сервер вернул неожиданный ответ. Попробуйте позже.', true);
        return;
      }

      const data = result.data;

      if (!data.channel_active) {
        showInfoState('ℹ️', 'Канал не подключён', 'Этот стример не использует Tribute Alerts.');
        return;
      }

      if (!data.is_linked) {
        showUnlinked(login, channel);
      } else {
        await renderLinkedState(login, channel, data);
      }
    } catch {
      showInfoState('⚠️', 'Ошибка соединения', 'Не удалось подключиться к серверу. Попробуйте позже.', true);
    }
  }

  const cancelBtn = $('cancelPollingBtn');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      stopPolling();
      if (pollingLogin && pollingChannel) {
        showUnlinked(pollingLogin, pollingChannel);
      } else {
        showState('stateNotOnTwitch');
      }
    };
  }

  const versionBadge = $('headerBadge');
  if (versionBadge) {
    versionBadge.textContent = `v${chrome.runtime.getManifest().version}`;
    versionBadge.href = `${BACKEND_URL}/changelog`;
    versionBadge.addEventListener('click', () => {
      fetchExtensionInfo().then(info => {
        if (info?.latest_changelog_id) {
          chrome.storage.local.set({ last_seen_changelog_id: info.latest_changelog_id });
        }
      }).catch(() => {});
      const dot = $('changelogDot');
      if (dot) dot.classList.remove('visible');
    });
  }

  fetchExtensionInfo().then(info => {
    checkAndShowUpdateBanner();
    checkChangelogDot(info);
  }).catch(() => {
    checkAndShowUpdateBanner();
  });
  renderState();

  async function checkChangelogDot(info) {
    try {
      const latestId = info?.latest_changelog_id;
      if (!latestId) return;

      const local = await chrome.storage.local.get('last_seen_changelog_id');
      if (local.last_seen_changelog_id === latestId) return;

      const dot = $('changelogDot');
      if (dot) dot.classList.add('visible');
    } catch { /* non-critical */ }
  }
})();
