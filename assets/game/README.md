# Game sprites

Drop PNGs here to replace the shapes the demo draws, then point `demo.js` at
them (one line each, see below). It falls back to the drawn shape if a file
is missing or fails to load.

| File | What it replaces | Drawn at |
|------|------------------|----------|
| `plane.png` | the craft you fly | 56 x 36 |
| `coin.png`  | seeds             | 26 x 26 |
| `fuel.png`  | fuel canisters    | 30 x 36 |

**Use transparent PNGs.** The background shows through, so anything on a white
or coloured rectangle will look like a sticker.

**Any resolution works.** The image is scaled to the size in the table, so 2x
or 3x art (112x72 for the plane, say) just looks sharper on high-DPI screens.
Match the aspect ratio or it will look stretched.

**The plane sprite should face right** and be roughly centred in its canvas —
it is drawn around its centre point and rotated to match the climb angle.

To change the drawn size, edit the `SPRITES` block near the top of
`../../demo.js`.

Remember to bump the `?v=` numbers in `index.html` after changing `demo.js`,
or returning visitors keep the cached version.

## Turning one on

Open `demo.js`, find the `SPRITES` block near the top, and replace `null` with
the path:

```js
const SPRITES = {
  plane: { src: 'assets/game/plane.png', w: 56, h: 36 },
  coin:  { src: null, w: 26, h: 26 },
  fuel:  { src: null, w: 30, h: 36 },
};
```

They start as `null` so the browser is not requesting files that do not exist
yet — otherwise every visitor's console fills with 404s.
