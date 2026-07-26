# 💌 Emoji Text Generator

Turn any short message into big block letters made of emoji, then copy it
straight into WhatsApp.

Plain **HTML + CSS + JavaScript**. No build step, no frameworks, no internet
needed once loaded — just open `index.html`.

<p align="center">
  <img src="assets/screenshots/preview.png" alt="The app on a phone" width="320">
</p>

---

## What it does

You give it three things:

| Input | What it means | Example |
| --- | --- | --- |
| **Main symbol** | the emoji the letters are drawn with | ❤️ |
| **Background symbol** | the emoji that fills the empty space | ⬜ |
| **Row count** | how many emoji tall each letter is | `12` |

…plus your message, and it draws every letter as a block, **stacked
vertically** — one letter on top of the next.

Stacking is deliberate: WhatsApp on a phone only fits about 10–12 emoji per
line. Writing letters side by side would make a long message wrap and the
picture would fall apart. Stacked, the art stays ~9 emoji wide and always
looks right.

Then hit **📋 Copy** or **💬 Send on WhatsApp**.

### Example — `I <3 U` at row count 12

```
❤️❤️❤️❤️❤️❤️❤️❤️❤️
❤️❤️❤️❤️❤️❤️❤️❤️❤️
⬜⬜⬜⬜❤️⬜⬜⬜⬜
⬜⬜⬜⬜❤️⬜⬜⬜⬜
⬜⬜⬜⬜❤️⬜⬜⬜⬜
       ...
```

---

## Features

- **A–Z, 0–9** and `. , ! ? : ' - _ + = / ( ) *` — hand-drawn twice, at 9×12 and
  5×7, so diagonals and curves stay clean at every size ([why](#adding-or-changing-a-letter))
- Type `<3` to get a ♥
- Lowercase is converted to uppercase automatically
- Quick-pick emoji buttons for both symbols, or paste any symbol you like
- Row count as a number box **and** a slider
- Live preview that lines up as a real grid, exactly like WhatsApp shows it
- Warns you if the art gets too wide for a phone screen
- One-click copy (with a fallback for older browsers)
- Sends the **whole** art to WhatsApp — see [Sharing](#sharing) below
- Remembers your last settings
- Works on mobile, light and dark mode

---

## Sharing

The obvious way to send to WhatsApp is a `https://wa.me/?text=...` link — but
it silently truncates. Every emoji becomes up to 18 characters once
percent-encoded (`❤️` → `%E2%9D%A4%EF%B8%8F`), so a 4-letter message at row
count 12 is already a **6,299-character URL**, and `I LOVE U` is **9,833**.
Phones and web servers cut URLs off around 8 KB, so only the first few letters
ever arrived.

So the app uses the **Web Share API** (`navigator.share`) instead. It hands the
text to WhatsApp as a string rather than stuffing it into a URL, so there is no
length limit and nothing gets cut off. This is what every phone will use.

If that API isn't available (desktop Firefox, Chrome on Linux) it falls back to
the `wa.me` link — but **only** while the URL stays under 6,000 characters. Past
that the button disables itself and says *"Too long to send"*, with a note
telling you to use **📋 Copy** instead. It will never again send you a half
message without warning.

**Copy always works, at any size.**

---

## Run it locally

Just open the file:

```bash
xdg-open index.html      # Linux
open index.html          # macOS
```

Or serve it, if you prefer:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

---

## Put it on GitHub Pages

1. Create a repo on GitHub (e.g. `emoji-text-generator`).

2. Push these files to it:

   ```bash
   git init
   git add .
   git commit -m "Emoji text generator"
   git branch -M main
   git remote add origin https://github.com/<your-username>/emoji-text-generator.git
   git push -u origin main
   ```

3. On GitHub go to **Settings → Pages**.

4. Under **Build and deployment → Source** pick **Deploy from a branch**,
   choose branch **`main`** and folder **`/ (root)`**, then **Save**.

5. Wait ~1 minute. Your site is live at:

   ```
   https://<your-username>.github.io/emoji-text-generator/
   ```

`index.html` sits in the root and all paths are relative, so it works with no
extra configuration.

---

## Tips for a picture that looks good on WhatsApp

- **Keep the row count between 10 and 14.** Bigger letters mean a wider
  picture, and once it passes ~12 emoji wide WhatsApp will wrap it.
- **Use two emoji of the same kind.** Squares with squares (⬜/🟥), hearts with
  hearts (🤍/❤️). Mixing an emoji with a plain character like `-` breaks the
  alignment, because they are not the same width.
- **Keep messages short.** `I LOVE U` is ~8 blocks; a long sentence turns into
  a very long scroll.
- Send it as **one message** — don't let it split.

---

## Files

| File | What's in it |
| --- | --- |
| `index.html` | the page and its controls |
| `style.css` | mobile-first styling, light + dark |
| `fonts.js` | the two pixel fonts — every letter shape lives here |
| `script.js` | scaling, rendering, copy and share |

### Adding or changing a letter

Everything lives in `fonts.js`, as rows of `#` (main symbol) and `.`
(background). There are two hand-drawn masters:

```js
FONT_LARGE   // 9 x 12, used for row counts 9 and up
FONT_SMALL   // 5 x  7, used for row counts 7 - 8
```

```js
'K': ['##.....##',      // FONT_LARGE
      '##....##.',
      '##...##..',
      '##..##...',
      '##.##....',
      '####.....',
      '####.....',
      '##.##....',
      '##..##...',
      '##...##..',
      '##....##.',
      '##.....##'],
```

**Why two fonts?** A 5×7 grid has no room to describe a diagonal or a curve —
the middle of an `N` gets three usable pixels, so scaling it up to 12 rows turns
each one into a 2×2 block and you get a staircase. Straight letters like `T`,
`F` and `Z` survive that fine; `N`, `K`, `W`, `C`, `G`, `J`, `Q` and `S` do not.

`FONT_LARGE` is drawn at 9×12 — the exact size the default row count renders at,
so at row count 12 nothing is scaled at all. Diagonals step one column per row
and bowls get real rounded corners.

Design rules for `FONT_LARGE`: strokes are 2px thick (3px for stems that must
sit dead centre, since 2 cannot be centred in 9); diagonals move one column per
row; every stroke stays 8-connected so nothing floats. `W` is an exact vertical
flip of `M`, and `9` is a 180° rotation of `6`.

Neither master is ever rendered *smaller* than it was drawn — that is why the
minimum row count is 7. Below that, whole source rows get dropped and thin
strokes vanish outright (at 5 rows the `!` and `'` disappeared completely).
Above it the renderer samples from the centre of each cell, which keeps letters
symmetric at every size.
