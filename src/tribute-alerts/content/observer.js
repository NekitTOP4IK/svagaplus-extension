const globalObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;

      if (node.classList && (node.classList.contains('seventv-message') || node.classList.contains('seventv-user-message'))) {
        if (typeof processSevenTVMessage !== 'undefined') processSevenTVMessage(node);
      }

      if (node.classList && node.classList.contains('chat-line__message')) {
        if (typeof processNativeMessage !== 'undefined') processNativeMessage(node);
      }

      if (node.classList && (node.classList.contains('seventv-user-card-float') || node.classList.contains('seventv-user-card'))) {
        if (typeof processUserCard !== 'undefined') processUserCard(node);
      }

      if (node.classList && node.classList.contains('viewer-card')) {
        if (typeof processUserCard !== 'undefined') processUserCard(node);
      }

      if (node.querySelectorAll) {
        const seventvMsgs = node.querySelectorAll('.seventv-message, .seventv-user-message');
        if (seventvMsgs.length && typeof processSevenTVMessage !== 'undefined') {
          seventvMsgs.forEach(processSevenTVMessage);
        }

        const nativeMsgs = node.querySelectorAll('.chat-line__message');
        if (nativeMsgs.length && typeof processNativeMessage !== 'undefined') {
          nativeMsgs.forEach(processNativeMessage);
        }

        const seventvCards = node.querySelectorAll('.seventv-user-card-float, .seventv-user-card');
        if (seventvCards.length && typeof processUserCard !== 'undefined') {
          seventvCards.forEach(processUserCard);
        }

        const nativeCards = node.querySelectorAll('.viewer-card, [data-a-target="viewer-card"]');
        if (nativeCards.length && typeof processUserCard !== 'undefined') {
          nativeCards.forEach(processUserCard);
        }
      }
    }
  }
});

function startGlobalObserver() {
  if (document.body) {
    globalObserver.observe(document.body, { childList: true, subtree: true });

    if (typeof processSevenTVMessage !== 'undefined') {
      document.querySelectorAll('.seventv-message, .seventv-user-message').forEach(processSevenTVMessage);
    }
    if (typeof processNativeMessage !== 'undefined') {
      document.querySelectorAll('.chat-line__message').forEach(processNativeMessage);
    }
    if (typeof processUserCard !== 'undefined') {
      document.querySelectorAll('.seventv-user-card-float, .viewer-card').forEach(processUserCard);
    }
  } else {
    setTimeout(startGlobalObserver, 100);
  }
}

if (typeof loadConfig !== 'undefined') {
  loadConfig(() => {
    startGlobalObserver();
  });
}
