/* ==========================================================================
   Page behaviour (not the game — that lives in demo.js).
   ========================================================================== */

(() => {
  'use strict';

  /* ------------------------------ footer year ---------------------------- */

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  /* ---------------------------- email assembly ---------------------------
     The address is never written into the HTML source, and never appears as a
     contiguous string anywhere in this file either. Address harvesters
     overwhelmingly regex static markup for `mailto:` and `x@y.tld`; with the
     parts split like this there is nothing for that pattern to match.

     This does not stop a scraper that executes JavaScript — nothing on a
     public page can. It stops the cheap, high-volume kind, which is the kind
     that actually fills an inbox with spam.
     ---------------------------------------------------------------------- */

  const LOCAL  = ['carol', '.', 'toyoshima'];
  const DOMAIN = ['gmail', 'com'];

  const address = LOCAL.join('') + String.fromCharCode(64) + DOMAIN.join('.');

  document.querySelectorAll('[data-email]').forEach((el) => {
    el.setAttribute('href', 'mai' + 'lto:' + address);
    // `data-email="label"` keeps whatever text is already there (e.g. "Email");
    // anything else shows the address itself.
    if (el.dataset.email !== 'label') el.textContent = address;
  });

  /* -------------------------- case-study dot nav --------------------------
     The floating rail spanning Games and Cases: visible while any of its
     data-sections is on screen, with the dot for whichever article is most
     in view lit up. Its scope (data-sections="games cases") lets one rail
     cover articles split across multiple <section>s. */

  if ('IntersectionObserver' in window) {
    document.querySelectorAll('.case-dots').forEach((dots) => {
      const sectionIds = (dots.dataset.sections || '').trim().split(/\s+/).filter(Boolean);
      const sections = sectionIds.map((id) => document.getElementById(id)).filter(Boolean);
      const articles = sections.flatMap((s) => Array.from(s.querySelectorAll('article[id]')));
      if (!sections.length || !articles.length) return;

      const visibleSections = new Set();
      const sectionObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visibleSections.add(entry.target);
          else visibleSections.delete(entry.target);
        });
        dots.classList.toggle('is-visible', visibleSections.size > 0);
      }, { rootMargin: '-45% 0px -45% 0px' });
      sections.forEach((section) => sectionObserver.observe(section));

      const dotFor = (id) => dots.querySelector(`[data-case="${id}"]`);
      const articleObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const dot = dotFor(entry.target.id);
          if (dot) dot.classList.toggle('is-active', entry.isIntersecting);
        });
      }, { rootMargin: '-45% 0px -45% 0px' });
      articles.forEach((article) => articleObserver.observe(article));
    });
  }
})();
