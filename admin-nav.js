// Shared admin navigation bar — injected into all admin pages
(function() {
  const pages = [
    { href: 'triage.html', label: 'Triage', icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
    { href: 'review.html', label: 'Members', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' },
    { href: 'engagement.html', label: 'Engagement', icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>' },
    { href: 'audit.html', label: 'Audit Log', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>' }
  ];

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  // Inject CSS once
  const style = document.createElement('style');
  style.textContent = `
    .admin-nav-bar {
      display: flex;
      gap: var(--space-2);
      margin-bottom: var(--space-6);
      padding-bottom: var(--space-4);
      border-bottom: 1px solid var(--color-border-light);
    }
    .admin-nav-bar a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-1);
      flex: 1;
      padding: var(--space-2) var(--space-2);
      min-height: 44px;
      background: var(--color-bg-card);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
      text-decoration: none;
      transition: all var(--transition-fast);
      white-space: nowrap;
    }
    .admin-nav-bar a:hover { border-color: var(--color-primary); color: var(--color-primary); }
    .admin-nav-bar a.active { background: var(--color-primary); border-color: var(--color-primary); color: white; }
    .admin-nav-bar a svg { width: 14px; height: 14px; flex-shrink: 0; }
    .admin-nav-bar .nav-home {
      flex: 0 0 auto;
      background: none;
      border-color: transparent;
      color: var(--color-text-muted);
      padding: var(--space-2);
    }
    .admin-nav-bar .nav-home:hover { color: var(--color-primary); border-color: transparent; }
    .admin-nav-bar .nav-home span { display: none; }
  `;
  document.head.appendChild(style);

  // Build nav HTML
  const links = pages.map(p => {
    const active = p.href === currentPage ? ' class="active"' : '';
    return `<a href="${p.href}"${active}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${p.icon}</svg>${p.label}</a>`;
  }).join('');

  const homeLink = `<a href="index.html" class="nav-home" title="Back to home"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></a>`;

  window.renderAdminNav = function(targetId) {
    const target = document.getElementById(targetId);
    if (!target) return;
    const nav = document.createElement('nav');
    nav.className = 'admin-nav-bar';
    nav.innerHTML = links + homeLink;
    target.insertAdjacentElement('afterend', nav);
  };

  window.injectAdminNav = function() {
    // Auto-inject: find the first header-like element and insert after it
    const header = document.querySelector('.admin-header, .page-header, .audit-header, .review-banner');
    if (!header) return;
    const nav = document.createElement('nav');
    nav.className = 'admin-nav-bar';
    nav.innerHTML = links + homeLink;
    header.insertAdjacentElement('afterend', nav);
  };
})();
