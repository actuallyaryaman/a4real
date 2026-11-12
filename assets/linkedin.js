/* LinkedIn is contacted only after an explicit button activation. */
(() => {
  const validEmbed = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'www.linkedin.com'
        && !url.username && !url.password && (!url.port || url.port === '443')
        && /^\/embed\/feed\/update\/urn:li:(activity|share|ugcPost):\d+\/?$/.test(url.pathname);
    } catch { return false; }
  };
  for (const button of document.querySelectorAll('.embed-toggle')) {
    if (!validEmbed(button.dataset.embedUrl)) continue;
    const slot = document.getElementById(button.getAttribute('aria-controls'));
    const status = button.closest('.linkedin-post').querySelector('.embed-status');
    if (!slot || !status) continue;
    let frame = null;
    button.hidden = false;
    button.addEventListener('click', () => {
      if (frame) {
        frame.remove(); frame = null;
        slot.removeAttribute('aria-busy');
        button.setAttribute('aria-expanded', 'false');
        button.textContent = button.dataset.loadLabel;
        status.textContent = 'Embedded post closed.';
        button.focus({ preventScroll: true });
        return;
      }
      frame = document.createElement('iframe');
      frame.className = 'linkedin-frame';
      frame.title = `LinkedIn post: ${button.dataset.title}`;
      frame.height = button.dataset.height;
      frame.width = '100%';
      frame.referrerPolicy = 'no-referrer';
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
      const current = frame;
      current.addEventListener('load', () => {
        if (frame !== current) return;
        slot.removeAttribute('aria-busy');
        // An iframe load event cannot establish whether a cross-origin post is available.
        status.textContent = 'If the post does not appear, use View on LinkedIn.';
      });
      current.addEventListener('error', () => {
        if (frame !== current) return;
        slot.removeAttribute('aria-busy');
        status.textContent = 'The embedded post could not be opened. Use View on LinkedIn.';
      });
      slot.setAttribute('aria-busy', 'true');
      status.textContent = 'Opening LinkedIn content. View on LinkedIn is also available.';
      button.setAttribute('aria-expanded', 'true');
      button.textContent = button.dataset.hideLabel;
      current.src = button.dataset.embedUrl;
      slot.append(current);
    });
  }
})();
