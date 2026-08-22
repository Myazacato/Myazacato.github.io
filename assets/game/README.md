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

## Animation — use a sprite sheet, not a GIF

**Animated GIFs do not work.** Canvas draws only the first frame of a GIF and
ignores the rest, and there is no flag to change that. The same applies to
animated WebP and APNG. It is a limitation of `drawImage`, not of this demo.

Use a **sprite sheet** instead: every frame in one PNG, all the same size, laid
out left to right.

```
[ frame 1 ][ frame 2 ][ frame 3 ][ frame 4 ]     <- one 256x64 png, 4 frames
```

Then say how many frames it holds and how fast to play them:

```js
plane: { src: 'assets/game/dog.png', w: 56, h: 36, frames: 4, fps: 12 },
```

- Every frame must be the **same width and height**. The frame size is worked
  out by dividing the image, so uneven frames will drift.
- `fps` is frames per second — 8 to 12 reads well for a flight cycle.
- For a grid instead of a strip, add `cols`. Frames fill left to right, then
  wrap: `frames: 8, cols: 4` is a 4x2 sheet.
- `w`/`h` are the on-canvas size of **one frame**, not the whole sheet.

A sheet is also better art than a GIF would be: full colour and soft alpha
edges, where GIF gives you 256 colours and hard-edged cutouts that look ragged
against a dark background.

### Making one

Any of these work: Aseprite (File > Export Sprite Sheet), Piskel (free, in
browser), TexturePacker, or just laying frames out on one canvas in Photoshop
or Figma and exporting once. Keep the character centred in each frame and
facing right, or it will appear to jitter as it animates.
