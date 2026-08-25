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
     The floating rail next to the Cases section: visible only while a case
     article is actually on screen, with the dot for whichever one is most in
     view lit up. One observer does both jobs — the section's own visibility
     drives .is-visible on the rail, and each article's visibility drives
     .is-active on its matching dot. */

  const caseDots = document.querySelector('.case-dots');
  const caseSection = document.getElementById('cases');
  const caseArticles = document.querySelectorAll('#cases article[id]');

  if (caseDots && caseSection && caseArticles.length && 'IntersectionObserver' in window) {
    const sectionObserver = new IntersectionObserver(
      ([entry]) => caseDots.classList.toggle('is-visible', entry.isIntersecting),
      { rootMargin: '-45% 0px -45% 0px' }
    );
    sectionObserver.observe(caseSection);

    const dotFor = (id) => caseDots.querySelector(`[data-case="${id}"]`);
    const articleObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const dot = dotFor(entry.target.id);
        if (dot) dot.classList.toggle('is-active', entry.isIntersecting);
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    caseArticles.forEach((article) => articleObserver.observe(article));
  }
})();
