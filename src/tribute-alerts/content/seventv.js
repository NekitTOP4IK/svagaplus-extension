function processSevenTVMessage(messageElement) {
  if (messageElement.dataset.tcbDone) return;

  const userBlock = messageElement.querySelector('.seventv-chat-user');
  if (!userBlock) return;

  const usernameEl = messageElement.querySelector('.seventv-chat-user-username');
  if (!usernameEl) return;

  const rawText = (usernameEl.textContent || '').replace(/^@/, '').trim();
  const intlMatch = rawText.match(/\((\w+)\)\s*$/);
  const username = intlMatch ? intlMatch[1].toLowerCase() : rawText.toLowerCase();

  if (!username) return;

  messageElement.dataset.tcbDone = '1';
  userBlock.dataset.tcbUser = username;

  userBlock.querySelectorAll('.tcb-badge-img').forEach(b => b.remove());
  userBlock.querySelectorAll('.tcb-badge-list-stv').forEach(b => b.remove());

  const userConfig = typeof cachedUsers !== 'undefined' ? cachedUsers[username] : null;
  if (!userConfig) return;

  if (!usernameEl.dataset.tcbTooltip) {
    usernameEl.dataset.tcbTooltip = '1';
    usernameEl.addEventListener('mouseenter', (e) => {
      const cfg = typeof cachedUsers !== 'undefined' ? cachedUsers[username] : null;
      if (cfg && cfg.name_preset_name) showTooltip(e, `Preset: ${cfg.name_preset_name}`);
    });
    usernameEl.addEventListener('mouseleave', hideTooltip);
  }

  const badges = typeof resolveBadgesForUser !== 'undefined' ? resolveBadgesForUser(userConfig) : [];
  if (badges.length === 0) return;

  // Append to 7TV's badge list to inherit its layout; create a fallback container if absent.
  let badgeList = userBlock.querySelector('.seventv-chat-user-badge-list');
  if (!badgeList) {
    badgeList = document.createElement('span');
    badgeList.className = 'tcb-badge-list-stv';
    usernameEl.insertAdjacentElement('beforebegin', badgeList);
  }

  badges.forEach((badge) => {
    const img = createBadgeImg(badge);
    if (img) {
      img.classList.add('seventv-chat-badge');
      badgeList.appendChild(img);
    }
  });
}
