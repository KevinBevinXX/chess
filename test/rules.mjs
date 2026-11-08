/* Chess rules, exercised through the real UI: real positions, real clicks.
   No network needed -- one page, driving both colours. */
import { launch, tracker, reporter, URL } from './browser.mjs';

const R = reporter();
const { errs, watch } = tracker();
const b = await launch();
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
watch('page', p);
await p.goto(URL, { waitUntil: 'networkidle' });
await p.evaluate(() => {
  document.querySelector('#lobby').classList.add('hidden');
  document.querySelector('#game').classList.remove('hidden');
});

/** Put a real position on the board and hand the local player a colour. */
async function setup(fen, color = 'w') {
  await p.evaluate(([fen, color]) => {
    const { state: S, render, paintMoves } = window.__chess;
    S.game.load(fen);
    S.connected = true; S.over = false; S.result = null;
    S.myColor = color; S.flipped = false; S.selected = null; S.targets = [];
    document.querySelector('#overlay').classList.add('hidden');
    document.querySelector('#promo').classList.add('hidden');
    render(); paintMoves();
  }, [fen, color]);
}
const click = async (sq) => { await p.click(`.sq[data-square="${sq}"]`); await p.waitForTimeout(80); };
/** Move, letting the local side own whichever colour is on turn. */
async function move(from, to) {
  await p.evaluate(() => {
    const { state: S, render } = window.__chess;
    S.myColor = S.game.turn(); render();
  });
  await click(from); await click(to); await p.waitForTimeout(130);
}
const fen = () => p.evaluate(() => window.__chess.state.game.fen());
const at = (sq) => p.evaluate((s) => { const g = window.__chess.state.game.get(s); return g ? g.color + g.type : null; }, sq);
const over = () => p.evaluate(() => ({
  shown: !document.querySelector('#overlay').classList.contains('hidden'),
  title: document.querySelector('#overTitle').textContent,
  text: document.querySelector('#overText').textContent,
}));

console.log('\n--- special moves ---');

await setup('rnbqkbnr/1pp1pppp/p7/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
await move('e5', 'd6');
(await at('d6')) === 'wp' && (await at('d5')) === null
  ? R.ok('en passant captures the passed pawn')
  : R.no('en passant', `d6=${await at('d6')} d5=${await at('d5')}`);

await setup('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
await move('e1', 'g1');
(await at('g1')) === 'wk' && (await at('f1')) === 'wr'
  ? R.ok('kingside castling moves king and rook') : R.no('kingside castling');

await setup('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
await move('e1', 'c1');
(await at('c1')) === 'wk' && (await at('d1')) === 'wr'
  ? R.ok('queenside castling moves king and rook') : R.no('queenside castling');

await setup('r3k2r/pppppppp/8/8/8/8/PPPP1PPP/R3K1qR w KQkq - 0 1');
let before = await fen(); await move('e1', 'g1');
(await fen()) === before ? R.ok('castling refused when the path is attacked')
                         : R.no('castling through an attacked square was allowed');

await setup('8/P6k/8/8/8/8/7K/8 w - - 0 1');
await click('a7'); await click('a8');
(await p.evaluate(() => !document.querySelector('#promo').classList.contains('hidden')))
  ? R.ok('promotion dialog appears') : R.no('promotion dialog did not appear');
await p.click('#promo .promo-row button:nth-child(4)');      // knight
await p.waitForTimeout(200);
(await at('a8')) === 'wn' ? R.ok('promotes to the chosen piece, not always a queen')
                          : R.no('promotion piece', await at('a8'));

console.log('\n--- how games end ---');

await setup('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
await move('a1', 'a8');
let o = await over();
o.shown && /checkmate/i.test(o.text) && o.title === 'You won'
  ? R.ok('checkmate detected and announced') : R.no('checkmate', JSON.stringify(o));

await setup('7k/8/8/5Q2/8/8/8/7K w - - 0 1');
await move('f5', 'g6');
o = await over();
o.shown && /stalemate/i.test(o.text) && o.title === 'Draw'
  ? R.ok('stalemate is a draw, not a win') : R.no('stalemate', JSON.stringify(o));

await setup('7k/8/8/8/7K/8/1b6/2B5 w - - 0 1');
await move('c1', 'b2');
o = await over();
o.shown && /material/i.test(o.text) ? R.ok('insufficient material is a draw')
                                    : R.no('insufficient material', JSON.stringify(o));

await setup('7k/8/8/8/8/8/R7/6K1 w - - 99 60');
await move('a2', 'a3');
o = await over();
o.shown && /fifty/i.test(o.text) ? R.ok('fifty-move rule is a draw')
                                 : R.no('fifty-move rule', JSON.stringify(o));

await setup('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
for (const [f, t] of [['g1','f3'],['g8','f6'],['f3','g1'],['f6','g8'],
                      ['g1','f3'],['g8','f6'],['f3','g1'],['f6','g8']]) await move(f, t);
o = await over();
o.shown && /three times/i.test(o.text) ? R.ok('threefold repetition is a draw')
                                       : R.no('threefold repetition', JSON.stringify(o));

console.log('\n--- refusals ---');

await setup('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'w');
await p.evaluate(() => { window.__chess.state.myColor = 'w'; window.__chess.render(); });
before = await fen(); await click('e7'); await click('e5');
(await fen()) === before ? R.ok("cannot move the opponent's pieces") : R.no("moved opponent's piece");

await setup('4k3/4r3/8/8/8/8/4R3/4K3 b - - 0 1', 'b');
before = await fen(); await move('e7', 'a7');          // rook pinned to its king
(await fen()) === before ? R.ok('a pinned piece cannot expose its own king')
                         : R.no('pinned piece was allowed to move');

// clicking empty squares, and clicking away from a selected piece, do nothing
await setup('4k3/8/8/8/8/8/8/4K2R w K - 0 1', 'w');
before = await fen();
await click('a4'); await click('a5');                 // both empty
(await fen()) === before ? R.ok('clicking empty squares makes no move')
                         : R.no('stray click changed the position');
await click('h1');                                    // select the rook
await click('b5');                                    // not one of its targets
const sel = await p.evaluate(() => window.__chess.state.selected);
(await fen()) === before && sel === null
  ? R.ok('clicking off a selected piece just deselects it')
  : R.no('deselect', `fenChanged=${(await fen()) !== before} selected=${sel}`);

if (errs.length) { console.log('\n--- page errors ---\n' + errs.join('\n')); R.no('javascript errors on the page'); }
await b.close();
process.exitCode = R.done() ? 1 : 0;
