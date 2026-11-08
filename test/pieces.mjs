/* The piece artwork and the move animations. */
import { launch, tracker, reporter, URL } from './browser.mjs';

const R = reporter();
const { errs, watch } = tracker();
const b = await launch();

async function board(opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, ...opts });
  const p = await ctx.newPage();
  watch('page', p);
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.evaluate(() => {
    document.querySelector('#lobby').classList.add('hidden');
    document.querySelector('#game').classList.remove('hidden');
    const { state: S, render } = window.__chess;
    S.connected = true; render();
  });
  return p;
}
const setup = (p, fen) => p.evaluate((fen) => {
  const { state: S, render } = window.__chess;
  S.game.load(fen); S.connected = true; S.over = false;
  S.myColor = S.game.turn(); S.flipped = false; S.selected = null; S.targets = [];
  document.querySelector('#overlay').classList.add('hidden');
  render();
}, fen);
const click = async (p, sq) => { await p.click(`.sq[data-square="${sq}"]`); await p.waitForTimeout(70); };

const p = await board();

console.log('\n--- artwork ---');
const sprite = await p.evaluate(() =>
  [...document.querySelectorAll('.sprite symbol')].map((s) => s.id).sort());
sprite.length === 12 ? R.ok('all 12 piece symbols are in the sprite')
                     : R.no('sprite symbols', sprite.join(','));
const hasViewBox = await p.evaluate(() =>
  [...document.querySelectorAll('.sprite symbol')].every((s) => s.getAttribute('viewBox') === '0 0 45 45'));
hasViewBox ? R.ok('every symbol has a viewBox so it scales') : R.no('a symbol is missing its viewBox');

const used = await p.evaluate(() => {
  const out = [...document.querySelectorAll('.sq .pc use')].map((u) => u.getAttribute('href'));
  return { count: out.length, uniq: [...new Set(out)].sort() };
});
used.count === 32 ? R.ok('all 32 starting pieces render as SVG') : R.no('piece count', used.count);
used.uniq.length === 12 ? R.ok('both colours of all six piece types are drawn')
                        : R.no('distinct pieces', used.uniq.join(','));

// the symbols actually resolve (a broken href renders an empty box)
const painted = await p.evaluate(() => {
  const u = document.querySelector('.sq .pc use');
  const r = u.getBoundingClientRect();
  return r.width > 4 && r.height > 4;
});
painted ? R.ok('a <use> reference resolves and paints') : R.no('piece artwork did not render');

const noGlyphs = await p.evaluate(() =>
  ![...document.querySelectorAll('.sq')].some((s) => /[♔-♟]/.test(s.textContent)));
noGlyphs ? R.ok('no Unicode glyph fallbacks left on the board') : R.no('a square still uses a text glyph');

/* Rasterise a symbol and measure how much of its ink is light fill.
   A gradient reference that fails to resolve still produces a <use> that
   paints -- it just paints the wrong colour -- so the structural checks above
   cannot catch it. Measured: healthy white pieces are 0.38-0.70 light, black
   pieces 0-0.25, and a broken white fill is exactly 0. */
function lightFraction(p, id, breakFills = false) {
  return p.evaluate(async ([id, breakFills]) => {
    const sprite = document.querySelector('.sprite').cloneNode(true);
    if (breakFills) sprite.innerHTML = sprite.innerHTML.replace(/url\(#gradW\)/g, '#000000');
    sprite.removeAttribute('class');
    sprite.setAttribute('width', 90); sprite.setAttribute('height', 90);
    sprite.setAttribute('viewBox', '0 0 45 45');
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', '#' + id);
    sprite.appendChild(u);
    const svg = new XMLSerializer().serializeToString(sprite);
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res; img.onerror = rej;
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    });
    const c = document.createElement('canvas'); c.width = c.height = 90;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, 90, 90);
    const d = g.getImageData(0, 0, 90, 90).data;
    let light = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;                       // opaque ink only
      n++;
      if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 190) light++;
    }
    return n > 200 ? light / n : -1;                      // -1 = barely drew
  }, [id, breakFills]);
}

console.log('\n--- piece colour (catches a broken gradient reference) ---');
for (const t of ['k', 'q', 'r', 'b', 'n', 'p']) {
  const w = await lightFraction(p, 'pc-w' + t);
  const k = await lightFraction(p, 'pc-b' + t);
  const f = (x) => x.toFixed(2);
  if (w < 0) { R.no(`${t}: white piece barely rendered`); continue; }
  if (k < 0) { R.no(`${t}: black piece barely rendered`); continue; }
  w >= 0.30 && k <= 0.30 && w - k > 0.1
    ? R.ok(`${t}: white is light fill (${f(w)}), black is dark (${f(k)})`)
    : R.no(`${t}: piece colours are wrong`, `white=${f(w)} black=${f(k)}`);
}

// prove the check above can actually fail: break the white fills and re-measure
const broken = await lightFraction(p, 'pc-wp', true);
broken >= 0 && broken < 0.05
  ? R.ok('the colour check detects a broken white fill (would read ' + broken.toFixed(2) + ')')
  : R.no('the colour check would not catch a broken fill', String(broken));

const malformed = await p.evaluate(() => {
  const html = document.querySelector('.sprite').innerHTML;
  // url(#id) must be followed by a quote, semicolon or space -- never stray hex
  return (html.match(/url\(#grad[WB]\)[0-9a-fA-F]+/g) || []);
});
malformed.length === 0 ? R.ok('no malformed gradient references in the sprite')
                       : R.no('malformed gradient reference', malformed.slice(0,3).join(','));

console.log('\n--- motion ---');

// a move animates the piece that moved
await setup(p, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
await click(p, 'e2');
await p.evaluate(() => { window.__chess.state.selected = 'e2'; });
await click(p, 'e4');
const anims = await p.evaluate(() => {
  const pc = document.querySelector('.sq[data-square="e4"] .pc');
  return pc ? pc.getAnimations().length : -1;
});
anims > 0 ? R.ok('the moved piece is animated into place') : R.no('no animation on the moved piece', anims);

// a capture leaves a ghost that then cleans itself up
await setup(p, 'rnbqkbnr/pppp1ppp/8/4p3/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2');
await click(p, 'd4'); await click(p, 'e5');
const ghostNow = await p.evaluate(() => document.querySelectorAll('.ghost').length);
ghostNow > 0 ? R.ok('a captured piece leaves a fading ghost') : R.no('no ghost on capture');
await p.waitForTimeout(700);
const ghostLater = await p.evaluate(() => document.querySelectorAll('.ghost').length);
ghostLater === 0 ? R.ok('the ghost is removed when it finishes')
                 : R.no('ghost left behind', ghostLater);

// castling animates the rook as well as the king
await setup(p, 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
await click(p, 'e1'); await click(p, 'g1');
const rookAnim = await p.evaluate(() => {
  const r = document.querySelector('.sq[data-square="f1"] .pc');
  return r ? r.getAnimations().length : -1;
});
rookAnim > 0 ? R.ok('castling animates the rook too') : R.no('rook not animated', rookAnim);

// captured material shows as artwork in the strip
await setup(p, 'rnbqkbnr/pppp1ppp/8/4p3/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2');
await click(p, 'd4'); await click(p, 'e5');
await p.waitForTimeout(300);
const capStrip = await p.evaluate(() => document.querySelectorAll('#capBottom .cap-pc').length);
capStrip === 1 ? R.ok('the captured pawn appears in the captured strip')
               : R.no('captured strip', capStrip);

console.log('\n--- reduced motion ---');
const p2 = await board({ reducedMotion: 'reduce' });
await setup(p2, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
await click(p2, 'e2'); await click(p2, 'e4');
const rm = await p2.evaluate(() => {
  const pc = document.querySelector('.sq[data-square="e4"] .pc');
  return pc ? pc.getAnimations().length : -1;
});
rm === 0 ? R.ok('no slide animation when the user asks for reduced motion')
         : R.no('animated despite prefers-reduced-motion', rm);
const movedAnyway = await p2.evaluate(() => !!window.__chess.state.game.get('e4'));
movedAnyway ? R.ok('the move still happens with motion turned off') : R.no('move lost under reduced motion');

if (errs.length) { console.log('\n--- page errors ---\n' + errs.join('\n')); R.no('javascript errors on the page'); }
await b.close();
process.exitCode = R.done() ? 1 : 0;
