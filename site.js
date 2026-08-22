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
})();
