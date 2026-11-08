/* Not a test: writes reference images into test/shots/ for eyeballing. */
import { launch, URL } from './browser.mjs';
const b = await launch();

// 1. every symbol, both colours, on a light and a dark square
{
  const p = await (await b.newContext({ viewport:{width:980,height:420}, deviceScaleFactor:2 })).newPage();
  await p.goto(URL, { waitUntil:'networkidle' });
  await p.evaluate(() => {
    document.body.innerHTML = document.querySelector('.sprite').outerHTML + '<div id="grid"></div>';
    const g = document.getElementById('grid');
    g.style.cssText = 'display:grid;grid-template-columns:repeat(6,1fr);width:900px;margin:10px';
    for (const [col,bg] of [['w','#eef0f3'],['b','#eef0f3'],['w','#7e97b8'],['b','#7e97b8']])
      for (const t of ['k','q','r','b','n','p']) {
        const d = document.createElement('div');
        d.style.cssText = `background:${bg};aspect-ratio:1;display:flex;align-items:center;justify-content:center`;
        d.innerHTML = `<svg viewBox="0 0 45 45" style="width:86%"><use href="#pc-${col}${t}"/></svg>`;
        g.appendChild(d);
      }
    document.body.style.background = '#fff';
  });
  await p.waitForTimeout(300);
  await p.locator('#grid').screenshot({ path:'shots/symbols.png' });
}

// 2. a board, light and dark theme
for (const [name, opts, fen, sel] of [
  ['board-light', {}, 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 5', 'c4'],
  ['board-dark', { colorScheme:'dark' }, 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4', null],
]) {
  const p = await (await b.newContext({ viewport:{width:900,height:900}, deviceScaleFactor:2, ...opts })).newPage();
  await p.goto(URL, { waitUntil:'networkidle' });
  await p.evaluate(([fen,sel]) => {
    document.querySelector('#lobby').classList.add('hidden');
    document.querySelector('#game').classList.remove('hidden');
    const { state:S, render, paintMoves } = window.__chess;
    S.game.load(fen); S.connected = true; S.myColor = S.game.turn(); S.flipped = false;
    if (sel) { S.selected = sel; S.targets = S.game.moves({ square:sel, verbose:true }); }
    render(); paintMoves();
  }, [fen, sel]);
  await p.waitForTimeout(400);
  await p.locator('.board-wrap').screenshot({ path:`shots/${name}.png` });
}
await b.close();
console.log('wrote test/shots/{symbols,board-light,board-dark}.png');
