function processNativeMessage(messageElement) {
  if (messageElement.dataset.tcbDone) return;

  const usernameElement = messageElement.querySelector('.chat-author__display-name');
  if (!usernameElement) return;

  // In FFZ/7TV addon mode data-a-user lives on the parent .chat-line__username, not on .chat-author__display-name.
  const username = (
    usernameElement.getAttribute('data-a-user') ||
    usernameElement.parentElement?.getAttribute('data-a-user') ||
    usernameElement.textContent ||
    ''
  ).toLowerCase().trim();

  if (!username) return;

  messageElement.dataset.tcbDone = '1';
  usernameElement.dataset.tcbUser = username;

  // FFZ/7TV addon paint is a CSS class on the parent, not an inline style. Suppress TRA gradient when active.
  const parentHasPaint = !!usernameElement.parentElement?.classList.contains('seventv-painted-content');
  if (parentHasPaint) {
    usernameElement.dataset.tcbPaint = '1';
  } else {
    delete usernameElement.dataset.tcbPaint;
  }

  const badgesContainer = messageElement.querySelector('.chat-line__message--badges');
  messageElement.querySelectorAll('.tcb-badge-list').forEach(b => b.remove());
  if (badgesContainer) badgesContainer.querySelectorAll('.tcb-badge-img').forEach(b => b.remove());

  const userConfig = typeof cachedUsers !== 'undefined' ? cachedUsers[username] : null;
  if (!userConfig) return;

  if (!usernameElement.dataset.tcbTooltip) {
    usernameElement.dataset.tcbTooltip = '1';
    usernameElement.addEventListener('mouseenter', (e) => {
      const cfg = typeof cachedUsers !== 'undefined' ? cachedUsers[username] : null;
      if (cfg && cfg.name_preset_name) showTooltip(e, `Preset: ${cfg.name_preset_name}`);
    });
    usernameElement.addEventListener('mouseleave', hideTooltip);
  }

  const badges = typeof resolveBadgesForUser !== 'undefined' ? resolveBadgesForUser(userConfig) : [];
  if (badges.length === 0) return;

  if (badgesContainer) {
    badges.forEach((badge) => {
      const img = createBadgeImg(badge);
      if (img) badgesContainer.appendChild(img);
    });
  } else {
    const wrapper = document.createElement('span');
    wrapper.className = 'tcb-badge-list';
    badges.forEach((badge) => {
      const img = createBadgeImg(badge);
      if (img) wrapper.appendChild(img);
    });
    if (wrapper.children.length > 0) {
      const insertTarget = usernameElement.closest('.chat-line__username') || usernameElement;
      insertTarget.insertAdjacentElement('beforebegin', wrapper);
    }
  }
}
