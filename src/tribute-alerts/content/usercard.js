function processUserCard(cardEl) {
  if (cardEl.dataset.tcbDone) return;

  const specificNameEl = cardEl.querySelector('.seventv-chat-user-username, .seventv-user-card-username, .tw-title, [data-a-target="user-card-header-username"], .viewer-card-header__display-name');

  const nameEls = Array.from(cardEl.querySelectorAll('span, h4, h2, h3, div')).filter(el => {
    return el.textContent && /^[a-zA-Z0-9_]{3,25}$/.test(el.textContent.trim());
  });

  let rawText = '';
  let targetNameEl = null;

  if (specificNameEl) {
    rawText = specificNameEl.textContent.trim();
    targetNameEl = specificNameEl;
  } else if (nameEls.length > 0) {
    rawText = nameEls[0].textContent.trim();
    targetNameEl = nameEls[0];
  } else {
    const match = cardEl.textContent.match(/([a-zA-Z0-9_]{3,25})/);
    if (match) rawText = match[1];
  }

  if (!rawText) return;

  const intlMatch = rawText.match(/\((\w+)\)\s*$/); // "DisplayName (login)"
  const username = (intlMatch ? intlMatch[1] : rawText).toLowerCase().trim();

  const config = typeof cachedUsers !== 'undefined' ? cachedUsers[username] : null;
  if (!config) return;

  cardEl.dataset.tcbDone = '1';

  const badges = typeof resolveBadgesForUser !== 'undefined' ? resolveBadgesForUser(config) : [];
  if (badges.length > 0) {
    const sevTVBadgeContainer = cardEl.querySelector('.seventv-user-card-badges');

    if (sevTVBadgeContainer) {
      sevTVBadgeContainer.querySelectorAll('.tcb-badge-list').forEach(b => b.remove());
      const wrapper = document.createElement('span');
      wrapper.className = 'tcb-badge-list tcb-badge-list--usercard';
      badges.forEach(badge => {
        const img = createBadgeImg(badge);
        if (img) wrapper.appendChild(img);
      });
      if (wrapper.children.length > 0) sevTVBadgeContainer.appendChild(wrapper);
    } else if (targetNameEl) {
      let badgeContainer = cardEl.querySelector('.tcb-badge-list');
      if (!badgeContainer) {
        badgeContainer = document.createElement('span');
        badgeContainer.className = 'tcb-badge-list tcb-badge-list--usercard';
        targetNameEl.insertAdjacentElement('beforebegin', badgeContainer);
      }
      badgeContainer.innerHTML = '';
      badges.forEach(badge => {
        const img = createBadgeImg(badge);
        if (img) badgeContainer.appendChild(img);
      });
    }
  }

  if (targetNameEl) {
    if (config.name_gradient) {
      targetNameEl.style.setProperty('background', config.name_gradient, 'important');
      targetNameEl.style.setProperty('-webkit-background-clip', 'text', 'important');
      targetNameEl.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
      targetNameEl.style.setProperty('color', 'transparent', 'important');
    } else if (config.name_color) {
      targetNameEl.style.setProperty('color', config.name_color, 'important');
    }
  }
}
