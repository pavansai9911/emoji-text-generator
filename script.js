/* ------------------------------------------------------------------
   Emoji Text Generator

   Takes:  message + main symbol + background symbol + row count
   Gives:  the message drawn as big block letters in emoji, stacked
           vertically (one letter per block) so WhatsApp on a phone
           never wraps and breaks the picture.
   ------------------------------------------------------------------ */

(function () {
  'use strict';

  /* ---------------- settings ---------------- */

  /* 7 is the floor because FONT_SMALL is drawn 7 rows tall. Below that we
     would be throwing source rows away, and thin strokes vanish outright -
     at 5 rows the "!" and "'" disappeared completely. Neither font is ever
     rendered smaller than it was drawn. */
  var MIN_ROWS = 7;
  var MAX_ROWS = 24;
  var SAFE_WIDTH = 12;      // more emoji per line than this may wrap on a phone

  /* Longest "https://wa.me/?text=..." url we dare to open.
     Each emoji becomes up to 18 characters once percent-encoded (❤️ ->
     %E2%9D%A4%EF%B8%8F), so the url explodes fast. Phones and web servers
     start silently truncating somewhere around 8 KB, which is why only the
     first few letters used to arrive. We stay well under that.
     This only applies to the fallback path - the Web Share API below has
     no such limit and is what mobile actually uses. */
  var WA_URL_LIMIT = 6000;

  var MAIN_PICKS = ['❤️', '💖', '💜', '🧡', '💛', '💚', '💙', '🌸', '🌹', '⭐', '✨', '🔥', '🥰', '😘', '🦋'];
  var BG_PICKS   = ['⬜', '⬛', '🤍', '🖤', '⚪', '⚫', '🟪', '🟦', '🟩', '🟨', '🟥', '🌑', '▫️', '➖'];

  /* ---------------- elements ---------------- */

  var el = {
    text:      document.getElementById('text'),
    main:      document.getElementById('mainSym'),
    bg:        document.getElementById('bgSym'),
    rows:      document.getElementById('rowCount'),
    range:     document.getElementById('rowRange'),
    mainPicks: document.getElementById('mainPicks'),
    bgPicks:   document.getElementById('bgPicks'),
    art:       document.getElementById('art'),
    artWrap:   document.getElementById('artWrap'),
    empty:     document.getElementById('empty'),
    stats:     document.getElementById('stats'),
    warn:      document.getElementById('warn'),
    copy:      document.getElementById('copyBtn'),
    share:     document.getElementById('shareBtn'),
    shareNote: document.getElementById('shareNote'),
    toast:     document.getElementById('toast')
  };

  var plainText = '';   // what actually gets copied / shared
  var artCols = 9;
  var shareMode = 'blocked';   // 'native' | 'url' | 'blocked'

  /* ------------------------------------------------------------------
     helpers
     ------------------------------------------------------------------ */

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* An emoji can be several code points (❤ + VS16, 👨‍👩‍👧, 👍🏽 ...).
     Pull out just the first complete one so the grid stays square. */
  function firstGrapheme(str) {
    if (!str) return '';

    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      var seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      var it = seg.segment(str)[Symbol.iterator]();
      var first = it.next();
      return first.done ? '' : first.value.segment;
    }

    // fallback for older browsers
    var cps = Array.from(str);
    var out = cps[0] || '';
    var i = 1;
    while (i < cps.length) {
      var cp = cps[i].codePointAt(0);
      var isModifier = cp === 0xFE0F || cp === 0xFE0E || cp === 0x20E3 ||
                       (cp >= 0x1F3FB && cp <= 0x1F3FF);
      if (isModifier) {
        out += cps[i];
        i += 1;
      } else if (cp === 0x200D) {              // zero width joiner
        out += cps[i] + (cps[i + 1] || '');
        i += 2;
      } else {
        break;
      }
    }
    return out;
  }

  /* Turn the typed message into glyph keys.
     "<3" and any heart character become the heart glyph. */
  function toGlyphKeys(str) {
    var s = str.toUpperCase();
    var keys = [];

    for (var i = 0; i < s.length; i++) {
      var ch = s[i];

      if (ch === '<' && s[i + 1] === '3') {
        keys.push(HEART_KEY);
        i += 1;
        continue;
      }
      if (ch === '♥' || ch === '❤' || ch === '♡' || ch === '💗') {
        keys.push(HEART_KEY);
        continue;
      }
      if (ch === '️' || ch === '︎') continue;   // stray variation selector
      if (ch === '\n' || ch === '\t') { keys.push(' '); continue; }

      keys.push(ch);
    }
    return keys;
  }

  /* Pick the master font to draw from. FONT_LARGE is 9x12 and is what
     makes diagonals and curves look right; FONT_SMALL only takes over
     at row counts too small to hold it. */
  function pickFont(outH) {
    return outH >= LARGE_FONT_MIN_ROWS ? FONT_LARGE : FONT_SMALL;
  }

  /* Output width that keeps the chosen font's proportions. */
  function widthFor(font, outH) {
    return Math.max(3, Math.round(font.w * outH / font.h));
  }

  /* A glyph plus the size it was drawn at. Falls back to the small font
     if the large one is ever missing a character. */
  function findGlyph(font, key) {
    if (font.glyphs[key]) return { rows: font.glyphs[key], w: font.w, h: font.h };
    if (FONT_SMALL.glyphs[key]) {
      return { rows: FONT_SMALL.glyphs[key], w: FONT_SMALL.w, h: FONT_SMALL.h };
    }
    return null;
  }

  /* Scale a glyph to outW x outH.

     Each output cell is sampled from the middle of its own slot
     ((i + 0.5) instead of i). That keeps the letter symmetric - both
     stems of a "U" come out the same thickness, which is not the case
     if you sample from the top-left corner of the slot.

     At the default row count of 12 the large font is already 9x12, so
     this is a straight copy and the letters come out exactly as drawn. */
  function scaleGlyph(g, outH, outW) {
    var rows = [];

    for (var y = 0; y < outH; y++) {
      var sy = Math.min(g.h - 1, Math.floor((y + 0.5) * g.h / outH));
      var src = g.rows[sy];
      var row = '';

      for (var x = 0; x < outW; x++) {
        var sx = Math.min(g.w - 1, Math.floor((x + 0.5) * g.w / outW));
        row += src[sx];
      }
      rows.push(row);
    }
    return rows;
  }

  function blankRows(count, width) {
    var rows = [];
    var blank = new Array(width + 1).join('.');
    for (var i = 0; i < count; i++) rows.push(blank);
    return rows;
  }

  /* ------------------------------------------------------------------
     the actual generator
     ------------------------------------------------------------------ */

  function buildGrid(message, rowCount) {
    var outH = rowCount;
    var font = pickFont(outH);
    var outW = widthFor(font, outH);
    var letterGap = Math.max(1, Math.round(outH / 7));
    var wordGap = letterGap * 2;

    var keys = toGlyphKeys(message);
    var grid = [];
    var unsupported = [];
    var pendingGap = 0;
    var drewSomething = false;

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];

      if (key === ' ') {
        if (drewSomething) pendingGap = wordGap;
        continue;
      }

      var glyph = findGlyph(font, key);
      if (!glyph) {
        if (unsupported.indexOf(key) === -1) unsupported.push(key);
        continue;
      }

      if (drewSomething) {
        grid = grid.concat(blankRows(pendingGap || letterGap, outW));
      }
      grid = grid.concat(scaleGlyph(glyph, outH, outW));

      pendingGap = 0;
      drewSomething = true;
    }

    return { grid: grid, cols: outW, unsupported: unsupported };
  }

  /* ------------------------------------------------------------------
     rendering
     ------------------------------------------------------------------ */

  function sizeCells(cols) {
    var avail = el.artWrap.clientWidth - 24;   // minus padding
    var cell = clamp(avail / cols, 8, 34);
    el.art.style.setProperty('--cols', cols);
    el.art.style.setProperty('--cell', cell.toFixed(2) + 'px');
  }

  function render() {
    var message = el.text.value;
    var main = firstGrapheme(el.main.value) || '❤️';
    var bg = firstGrapheme(el.bg.value) || '⬜';
    var rowCount = clamp(parseInt(el.rows.value, 10) || 12, MIN_ROWS, MAX_ROWS);

    var built = buildGrid(message, rowCount);
    var grid = built.grid;

    if (!grid.length) {
      plainText = '';
      artCols = built.cols;
      el.art.innerHTML = '';
      el.empty.hidden = false;
      el.stats.textContent = '—';
      el.copy.disabled = true;
      updateShare();
      showWarn(built.unsupported.length
        ? 'Nothing to draw. These are not supported: ' + built.unsupported.join(' ')
        : '');
      return;
    }

    el.empty.hidden = true;
    artCols = built.cols;

    // plain text version (this is what gets copied)
    var lines = new Array(grid.length);
    var html = '';

    for (var r = 0; r < grid.length; r++) {
      var row = grid[r];
      var line = '';
      for (var c = 0; c < row.length; c++) {
        var sym = row[c] === '#' ? main : bg;
        line += sym;
        html += '<span>' + escapeHtml(sym) + '</span>';
      }
      lines[r] = line;
    }

    plainText = lines.join('\n');
    el.art.innerHTML = html;
    sizeCells(built.cols);

    // stats
    var symbolCount = grid.length * built.cols;
    el.stats.textContent = built.cols + ' wide × ' + grid.length + ' rows · ' +
                           symbolCount.toLocaleString() + ' symbols';

    // warnings
    var msgs = [];
    if (built.unsupported.length) {
      msgs.push('Skipped (not in the font): ' + built.unsupported.join(' '));
    }
    if (built.cols > SAFE_WIDTH) {
      msgs.push('⚠️ ' + built.cols + ' symbols wide — WhatsApp may wrap this on a phone. ' +
                'Try a row count of 16 or less.');
    }
    showWarn(msgs.join('<br>'));

    el.copy.disabled = false;
    updateShare();

    saveSettings();
  }

  function showWarn(html) {
    if (!html) {
      el.warn.hidden = true;
      el.warn.innerHTML = '';
      return;
    }
    el.warn.innerHTML = html;
    el.warn.hidden = false;
  }

  /* ------------------------------------------------------------------
     copy / share
     ------------------------------------------------------------------ */

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.toast.classList.remove('show');
    }, 1800);
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);

    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function doCopy() {
    if (!plainText) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(plainText).then(
        function () { toast('Copied! Paste it in WhatsApp 💬'); },
        function () {
          toast(legacyCopy(plainText) ? 'Copied! Paste it in WhatsApp 💬' : 'Copy failed — long-press the art to select it');
        }
      );
    } else {
      toast(legacyCopy(plainText) ? 'Copied! Paste it in WhatsApp 💬' : 'Copy failed — long-press the art to select it');
    }
  }

  function waUrl(text) {
    return 'https://wa.me/?text=' + encodeURIComponent(text);
  }

  /* The Web Share API hands the text straight to WhatsApp as a string, so
     nothing gets cut off no matter how big the art is. Every mobile browser
     that matters supports it (over https). */
  function canNativeShare(text) {
    if (!navigator.share) return false;
    if (navigator.canShare) {
      try { return navigator.canShare({ text: text }); } catch (e) { return false; }
    }
    return true;
  }

  /* Work out how - or whether - this art can be sent, and say so on the
     button so the user is never left wondering why half of it arrived. */
  function updateShare() {
    if (!plainText) {
      shareMode = 'blocked';
      el.share.disabled = true;
      el.share.textContent = '💬 Send on WhatsApp';
      setShareNote('');
      return;
    }

    if (canNativeShare(plainText)) {
      shareMode = 'native';
    } else if (waUrl(plainText).length <= WA_URL_LIMIT) {
      shareMode = 'url';
    } else {
      shareMode = 'blocked';
    }

    if (shareMode === 'blocked') {
      el.share.disabled = true;
      el.share.textContent = '💬 Too long to send';
      el.share.title = 'This art is too big to send through a link. Use Copy instead.';
      setShareNote(
        '⚠️ <strong>Too long to send directly from this browser.</strong> ' +
        'Tap <strong>📋 Copy</strong> and paste it into WhatsApp — the whole thing will go. ' +
        '(Or use a shorter message / smaller row count.)',
        'warn-note'
      );
      return;
    }

    el.share.disabled = false;
    el.share.textContent = '💬 Send on WhatsApp';
    el.share.title = '';

    setShareNote(
      shareMode === 'native'
        ? 'Opens your share sheet — pick WhatsApp. The full art is sent, nothing is cut off.'
        : '',
      'info-note'
    );
  }

  function setShareNote(html, cls) {
    el.shareNote.className = 'share-note' + (cls ? ' ' + cls : '');
    if (!html) {
      el.shareNote.hidden = true;
      el.shareNote.innerHTML = '';
      return;
    }
    el.shareNote.innerHTML = html;
    el.shareNote.hidden = false;
  }

  function doShare() {
    if (!plainText || shareMode === 'blocked') return;

    if (shareMode === 'native') {
      // must be called straight from the click, so no await/setTimeout here
      navigator.share({ text: plainText }).catch(function (err) {
        if (err && err.name === 'AbortError') return;      // user closed the sheet
        if (waUrl(plainText).length <= WA_URL_LIMIT) {
          window.open(waUrl(plainText), '_blank', 'noopener');
        } else {
          toast('Could not share — use 📋 Copy instead');
        }
      });
      return;
    }

    window.open(waUrl(plainText), '_blank', 'noopener');
  }

  /* ------------------------------------------------------------------
     quick pick buttons
     ------------------------------------------------------------------ */

  function buildPicks(container, list, input) {
    var html = '';
    for (var i = 0; i < list.length; i++) {
      html += '<button type="button" class="pick" data-sym="' + escapeHtml(list[i]) + '">' +
              escapeHtml(list[i]) + '</button>';
    }
    container.innerHTML = html;

    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.pick');
      if (!btn) return;
      input.value = btn.dataset.sym;
      markActive(container, input.value);
      render();
    });
  }

  function markActive(container, value) {
    var btns = container.querySelectorAll('.pick');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].dataset.sym === value);
    }
  }

  function refreshActive() {
    markActive(el.mainPicks, el.main.value);
    markActive(el.bgPicks, el.bg.value);
  }

  /* ------------------------------------------------------------------
     persistence (so her settings survive a reload)
     ------------------------------------------------------------------ */

  var STORE = 'emoji-text-generator';

  function saveSettings() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        text: el.text.value,
        main: el.main.value,
        bg: el.bg.value,
        rows: el.rows.value
      }));
    } catch (e) { /* private mode - ignore */ }
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (typeof s.text === 'string') el.text.value = s.text;
      if (s.main) el.main.value = s.main;
      if (s.bg) el.bg.value = s.bg;
      if (s.rows) {
        // an older session may have stored a row count below today's minimum
        var n = clamp(parseInt(s.rows, 10) || 12, MIN_ROWS, MAX_ROWS);
        el.rows.value = n;
        el.range.value = n;
      }
    } catch (e) { /* corrupt - ignore */ }
  }

  /* ------------------------------------------------------------------
     wiring
     ------------------------------------------------------------------ */

  var debounceTimer;
  function renderSoon() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, 90);
  }

  function syncRows(source) {
    var n = clamp(parseInt(source.value, 10) || 12, MIN_ROWS, MAX_ROWS);
    el.rows.value = n;
    el.range.value = n;
  }

  function init() {
    buildPicks(el.mainPicks, MAIN_PICKS, el.main);
    buildPicks(el.bgPicks, BG_PICKS, el.bg);

    loadSettings();
    refreshActive();

    el.text.addEventListener('input', renderSoon);

    [el.main, el.bg].forEach(function (input) {
      input.addEventListener('input', function () {
        refreshActive();
        renderSoon();
      });
      // keep only the first emoji once the user leaves the box
      input.addEventListener('blur', function () {
        var g = firstGrapheme(input.value);
        if (g && g !== input.value) {
          input.value = g;
          refreshActive();
          render();
        }
      });
    });

    el.rows.addEventListener('input', function () {
      // digits only
      var cleaned = el.rows.value.replace(/[^0-9]/g, '');
      if (cleaned !== el.rows.value) el.rows.value = cleaned;
      el.range.value = clamp(parseInt(cleaned, 10) || MIN_ROWS, MIN_ROWS, MAX_ROWS);
      renderSoon();
    });
    el.rows.addEventListener('blur', function () { syncRows(el.rows); render(); });

    el.range.addEventListener('input', function () { syncRows(el.range); renderSoon(); });

    el.copy.addEventListener('click', doCopy);
    el.share.addEventListener('click', doShare);

    window.addEventListener('resize', function () { sizeCells(artCols); });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
