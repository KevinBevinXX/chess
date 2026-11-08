/* Two independent browsers, connected over the real PeerJS cloud broker,
   the way two different computers would be. */
import { launch, tracker, reporter, URL } from './browser.mjs';

const R = reporter();
const { errs, watch } = tracker();
const b = await launch();
const A = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
const B = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
watch('A', A); watch('B', B);

const moves = (p) => p.evaluate(() => [...document.querySelectorAll('#moveList li')]
  .map((l) => [...l.querySelectorAll('span')].map((s) => s.textContent).join(' ')).join(' | '));
const click = async (p, sq) => { await p.click(`.sq[data-square="${sq}"]`); await p.waitForTimeout(110); };
const move = async (p, f, t) => { await click(p, f); await click(p, t); await p.waitForTimeout(450); };
const colorOf = (p) => p.evaluate(() => document.querySelector('#nameBottom').textContent);

// ---- host ----
await A.goto(URL, { waitUntil: 'networkidle' });
await A.click('#btnHost');
await A.waitForFunction(() => /^[A-Z0-9]{5}$/.test((document.querySelector('#codeDisplay')?.textContent || '').trim()),
  null, { timeout: 30000 });
const code = (await A.textContent('#codeDisplay')).trim();
console.log('\ngame code:', code);

// ---- join from the second browser, via the invite link ----
await B.goto(URL + '?join=' + code, { waitUntil: 'networkidle' });

let connected = true;
for (const [n, p] of [['A', A], ['B', B]]) {
  try {
    await p.waitForSelector('#game:not(.hidden)', { timeout: 45000 });
    await p.waitForFunction(() => document.querySelector('#conn')?.classList.contains('ok'), null, { timeout: 45000 });
  } catch { connected = false; R.no(`${n} never connected`); }
}
if (!connected) { console.log(errs.join('\n')); await b.close(); process.exit(1); }
R.ok('two separate browsers connected peer-to-peer');

const aWhite = (await colorOf(A)).includes('White');
const W = aWhite ? A : B, L = aWhite ? B : A;
(await colorOf(W)).includes('White') && (await colorOf(L)).includes('Black')
  ? R.ok('one player is White and the other Black') : R.no('colour assignment');

// ---- a real opening, alternating machines ----
for (const [p, f, t] of [[W,'e2','e4'],[L,'e7','e5'],[W,'g1','f3'],[L,'b8','c6'],
                         [W,'f1','c4'],[L,'g8','f6'],[W,'e1','g1']]) await move(p, f, t);
const mA = await moves(A), mB = await moves(B);
mA === mB ? R.ok('both browsers show the identical move list') : R.no('move lists diverged', `${mA} vs ${mB}`);
/O-O/.test(mA) ? R.ok('castling synced across the connection') : R.no('castling not in history', mA);

// ---- turn and legality are enforced on each machine ----
let before = await moves(W);
await move(W, 'd2', 'd4');                       // not White's turn
(await moves(W)) === before ? R.ok('a player cannot move out of turn') : R.no('moved out of turn');
before = await moves(L);
await move(L, 'e5', 'e3');                       // illegal
(await moves(L)) === before ? R.ok('an illegal move is refused') : R.no('illegal move accepted');

// ---- board orientation ----
const topLeft = (p) => p.evaluate(() => document.querySelector('.sq').dataset.square);
(await topLeft(W)) === 'a8' && (await topLeft(L)) === 'h1'
  ? R.ok('each player sees their own pieces at the bottom')
  : R.no('orientation', `${await topLeft(W)} / ${await topLeft(L)}`);

// ---- chat ----
await L.fill('#chatInput', 'hello from the other computer');
await L.press('#chatInput', 'Enter');
await W.waitForTimeout(800);
(await W.evaluate(() => document.querySelector('#chatLog').textContent)).includes('hello from the other computer')
  ? R.ok('chat crosses the connection') : R.no('chat not delivered');

await W.screenshot({ path: 'shots/white.png' });
await L.screenshot({ path: 'shots/black.png' });

// ---- resign reaches the other side ----
W.once('dialog', (d) => d.accept());
await W.click('#btnResign');
await L.waitForTimeout(900);
const lo = await L.evaluate(() => ({
  shown: !document.querySelector('#overlay').classList.contains('hidden'),
  title: document.querySelector('#overTitle').textContent,
}));
lo.shown && lo.title === 'You won' ? R.ok('a resignation is announced as a win on the other machine')
                                   : R.no('resign not received', JSON.stringify(lo));

// ---- rematch: both must agree, and colours swap ----
const wasW = await colorOf(W);
await L.click('#btnRematch');                     // offer
await W.waitForTimeout(500);
await W.click('#btnRematch');                     // accept
await W.waitForTimeout(1200);
const nowW = await colorOf(W);
nowW !== wasW ? R.ok('rematch starts a new game with colours swapped')
              : R.no('rematch colours did not swap', `${wasW} -> ${nowW}`);
const fresh = await W.evaluate(() => window.__chess.state.game.history().length);
fresh === 0 ? R.ok('rematch resets the board') : R.no('board not reset', 'plies=' + fresh);

if (errs.length) { console.log('\n--- page errors ---\n' + errs.join('\n')); R.no('javascript errors on the page'); }
await b.close();
process.exitCode = R.done() ? 1 : 0;
