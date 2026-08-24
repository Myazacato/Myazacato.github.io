# Portfolio

Personal portfolio site, hosted free on GitHub Pages at **https://myazacato.github.io**.

Plain HTML, CSS and JavaScript. No framework, no build step, no dependencies —
edit a file, commit, push, and it is live in about a minute.

```
index.html    all page content
style.css     all styling (palette matches the game's cyberpunk theme)
site.js       page behaviour: footer year, email assembly
demo.js       the playable Diana browser demo
robots.txt    crawler preferences
favicon.svg   tab icon
assets/art/   art images
```

## Privacy notes

A few deliberate choices, so they don't get undone by accident:

- **The email address is never written into the HTML.** `site.js` assembles it
  from parts at runtime and injects it into any element with a `data-email`
  attribute. Address harvesters regex static markup for `mailto:` and
  `x@y.tld`; there is nothing here for that to match. Do not "simplify" this
  back into a plain `mailto:` link. It does not stop a scraper that runs
  JavaScript — nothing on a public page does — but it stops the high-volume
  kind.
- **No phone number and no street-level location** on the page, by choice.
- **Commits use a GitHub noreply address**, not a personal one, so a public
  repo does not expose it through commit metadata. The repo-local git config
  is already set to keep it that way.
- **`robots.txt` allows search engines and asks bulk/AI crawlers to stay out.**
  It is a request, not a control — compliant crawlers honour it, scrapers
  ignore it.

## Editing

Open `index.html` and edit the text directly. The sections are marked with
comments (`<!-- ====== GAMES ====== -->` and so on).

Anything still needing real content is visibly outlined on the page:

- `class="ph-inline"` — an inline placeholder (your name, a profile link).
  Delete the class once the real text is in.
- `class="needs-content"` — a whole block that is still boilerplate.
  Delete the class once you have filled it in.

When both are gone, the dashed outlines and "PLACEHOLDER" labels disappear.

### Adding another game

Copy the whole `<article class="case">` block in the Games section and edit it.

### Adding art

Drop image files into `assets/art/`, then in the Art section replace each

```html
<div class="tile-ph">Drop art here</div>
```

with

```html
<img src="assets/art/your-file.png" alt="short description">
```

## Previewing locally

Opening `index.html` straight from disk works for the layout, but some browsers
restrict scripts on `file://` URLs, so serve it over HTTP instead:

```bash
npx serve .
```

Then open the URL it prints. Any static server works.

## After editing style.css, site.js or demo.js — bump the version

`index.html` loads them with a query string:

```html
<link rel="stylesheet" href="style.css?v=2">
<script src="site.js?v=2"></script>
<script src="demo.js?v=2"></script>
```

GitHub Pages tells browsers to cache assets for ten minutes, so without this a
returning visitor can get the new HTML with the old JavaScript — which breaks in
confusing ways. **Bump every `?v=` number together** (to `v=3`, then `v=4`, …)
whenever you change any of those three files. Editing only `index.html` needs no
bump.

## Deploying

The site is a GitHub Pages *user site*, which requires the repository to be
named exactly `Myazacato.github.io`. Pushing to `main` publishes it:

```bash
git add -A && git commit -m "Update portfolio" && git push
```

Changes appear at https://myazacato.github.io within a minute or so.

## The demo

`demo.js` is a condensed rebuild of the flight scene from
the Godot 4 project (private repo).
The speed curve, chunk spawner, cargo-damage values and delivery-grade
thresholds are taken from the real game so the feel carries over. It is a
separate implementation, not an export of the Godot build.

### Music

`assets/audio/valkyries.mp3` plays from Start Run to the results screen (a
mute toggle sits in the game's title bar, and the choice persists across
visits).

> Music by Nesrality, from [Pixabay](https://pixabay.com/music/). Used under
> the Pixabay Content License (free for commercial use, no attribution
> required — credited here anyway).
