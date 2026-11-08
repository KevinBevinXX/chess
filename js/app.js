/* Peer-to-peer chess.
   Rules: chess.js (vendored). Transport: PeerJS DataConnection (vendored).
   There is no server of ours: GitHub Pages serves these files, the two
   browsers talk directly. Both sides run the full rules, so neither has to
   trust the other's arithmetic -- an illegal move is simply rejected. */
import { Chess } from './vendor/chess.js';

/* ---------- peer id namespace ----------
   Codes are short and human-readable; the prefix keeps them from colliding
   with other people's ids on the shared PeerJS cloud broker. Ambiguous
   characters (I/O/0/1) are left out so a code can be read down a phone. */
const NS = 'kbxchess-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PROTO = 1;

const $ = (s) => document.querySelector(s);
const el = (t, c) => { const n = document.createElement(t); if (c) n.className = c; return n; };

const SVGNS = 'http://www.w3.org/2000/svg';
const NAMES = { k:'king', q:'queen', r:'rook', b:'bishop', n:'knight', p:'pawn' };

/** A piece, drawn from the inline <symbol> sprite in index.html. */
function pieceSvg(color, type, cls = 'pc') {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 45 45');
  svg.setAttribute('class', cls + ' ' + color);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVGNS, 'use');
  use.setAttribute('href', `#pc-${color}${type}`);
  svg.appendChild(use);
  return svg;
}
const FILES = 'abcdefgh';
const VALUE = { p:1, n:3, b:3, r:5, q:9 };

/* ================= state ================= */
const S = {
  game: new Chess(),
  peer: null,
  conn: null,
  myColor: 'w',
  hosting: false,
  code: null,
  flipped: false,
  selected: null,       // square currently picked up
  targets: [],          // legal moves from `selected`
  pendingPromo: null,   // {from,to} awaiting a piece choice
  over: false,
  result: null,
  rematchFromMe: false,
  rematchFromThem: false,
  connected: false,
};

/* ================= small ui helpers ================= */
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}
function lobbyError(msg) {
  const e = $('#lobbyError');
  e.textContent = msg;
  e.classList.toggle('hidden', !msg);
}
function randomCode(n = 5) {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => ALPHABET[x % ALPHABET.length]).join('');
}

/* ================= board rendering ================= */
const boardEl = $('#board');

function squareName(f, r) { return FILES[f] + (r + 1); }

/** Rebuild the 8x8 grid. Cheap enough at this size to redraw per move,
 *  which keeps the DOM a pure function of the position (no stale state). */
function render() {
  const g = S.game;
  const pos = g.board();                 // [rank8..rank1][file a..h]
  const last = g.history({ verbose: true }).slice(-1)[0];
  const checkSq = g.isCheck() ? kingSquare(g.turn()) : null;

  boardEl.innerHTML = '';
  // Draw from the mover's point of view: white at the bottom unless flipped.
  const ranks = S.flipped ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
  const files = S.flipped ? [...Array(8).keys()].reverse() : [...Array(8).keys()];

  for (const r of ranks) {
    for (const f of files) {
      const name = squareName(f, r);
      const piece = pos[7 - r][f];
      const sq = el('div', 'sq ' + ((f + r) % 2 ? 'lt' : 'dk'));
      sq.dataset.square = name;
      sq.setAttribute('role', 'gridcell');
      sq.setAttribute('aria-label', name + (piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${NAMES[piece.type]}` : ' empty'));

      if (last && (last.from === name || last.to === name)) sq.classList.add('last');
      if (checkSq === name) sq.classList.add('check');
      if (S.selected === name) sq.classList.add('sel');

      if (piece) {
        sq.appendChild(pieceSvg(piece.color, piece.type));
        if (canPickUp(piece)) sq.classList.add('movable');
      }

      const t = S.targets.find((m) => m.to === name);
      if (t) {
        sq.classList.add('tgt');
        if (piece) sq.classList.add('occupied-target');
        sq.appendChild(el('div', 'target'));
      }

      // edge coordinates, drawn on the rim the player is looking at
      const firstFile = S.flipped ? f === 7 : f === 0;   // left edge: ranks
      const lastRank  = S.flipped ? r === 7 : r === 0;   // bottom edge: files
      if (lastRank)  { const c = el('span', 'coord f'); c.textContent = FILES[f]; sq.appendChild(c); }
      if (firstFile) { const c = el('span', 'coord r'); c.textContent = r + 1; sq.appendChild(c); }

      boardEl.appendChild(sq);
    }
  }
  paintStatus();
  paintCaptured();
}

function kingSquare(color) {
  for (const row of S.game.board())
    for (const p of row)
      if (p && p.type === 'k' && p.color === color) return p.square;
  return null;
}

function canPickUp(piece) {
  return !S.over && S.connected && piece.color === S.myColor && S.game.turn() === S.myColor;
}

/* ================= status / history / captures ================= */
function paintStatus() {
  const g = S.game;
  const mine = g.turn() === S.myColor;
  let text;
  if (S.over) {
    text = S.result || 'Game over';
  } else if (!S.connected) {
    text = 'Waiting for opponent…';
  } else {
    text = mine ? 'Your move' : "Opponent's move";
    if (g.isCheck()) text += ' — check';
  }
  $('#status').textContent = text;

  $('#dotBottom').classList.toggle('on', mine && !S.over);
  $('#dotTop').classList.toggle('on', !mine && !S.over);

  const me = S.myColor === 'w' ? 'White' : 'Black';
  const them = S.myColor === 'w' ? 'Black' : 'White';
  $('#nameBottom').textContent = `You (${me})`;
  $('#nameTop').textContent = `Opponent (${them})`;
}

function paintMoves() {
  const h = S.game.history();
  const list = $('#moveList');
  list.innerHTML = '';
  for (let i = 0; i < h.length; i += 2) {
    const li = el('li');
    const w = el('span'); w.textContent = h[i] || '';
    li.appendChild(w);
    if (h[i + 1]) { const b = el('span'); b.textContent = h[i + 1]; li.appendChild(b); }
    list.appendChild(li);
  }
  list.scrollTop = list.scrollHeight;
}

/** Material each side has taken, shown next to its owner. */
function paintCaptured() {
  const taken = { w: [], b: [] };   // pieces LOST by each colour
  for (const m of S.game.history({ verbose: true })) {
    if (!m.captured) continue;
    const victim = m.color === 'w' ? 'b' : 'w';
    taken[victim].push(m.captured);
  }
  const sum = (a) => a.reduce((n, t) => n + (VALUE[t] || 0), 0);
  const theirColor = S.myColor === 'w' ? 'b' : 'w';
  const myEdge = sum(taken[theirColor]) - sum(taken[S.myColor]);
  const fill = (node, lost, color, edge) => {
    node.innerHTML = '';
    lost.sort((a, b) => (VALUE[b] || 0) - (VALUE[a] || 0))
        .forEach((t) => node.appendChild(pieceSvg(color, t, 'cap-pc')));
    if (edge > 0) { const tag = el('span', 'edge'); tag.textContent = `+${edge}`; node.appendChild(tag); }
  };
  fill($('#capBottom'), taken[theirColor], theirColor, myEdge);
  fill($('#capTop'), taken[S.myColor], S.myColor, -myEdge);
}

/* ================= animation =================
   Pieces slide to where they land and captured pieces fade out, so a move
   the opponent made is visible rather than just appearing. Everything here
   is decoration: if it is skipped the position on the board is identical. */
const reduceMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const sqEl = (name) => boardEl.querySelector(`.sq[data-square="${name}"]`);

/** Grid position of a square as currently drawn (col/row from the top left). */
function gridPos(name) {
  const f = FILES.indexOf(name[0]);
  const r = +name[1] - 1;
  return { col: S.flipped ? 7 - f : f, row: S.flipped ? r : 7 - r };
}

/** Slide the piece now sitting on `to` in from where it came. */
function slide(from, to, delay = 0) {
  const sq = sqEl(to);
  const pc = sq && sq.querySelector('.pc');
  if (!pc) return;
  const w = sq.getBoundingClientRect().width;
  if (!w) return;
  const a = gridPos(from), b = gridPos(to);
  const dx = (a.col - b.col) * w, dy = (a.row - b.row) * w;
  if (!dx && !dy) return;
  pc.animate(
    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
    { duration: 200, delay, easing: 'cubic-bezier(.22,.68,.3,1)', fill: 'backwards' });
}

/** Leave a fading copy of a captured piece on the square it was taken from. */
function fadeCapture(square, color, type) {
  const sq = sqEl(square);
  if (!sq) return;
  const g = el('div', 'ghost');
  g.appendChild(pieceSvg(color, type, 'pc'));
  sq.appendChild(g);
  const a = g.animate(
    [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.66)' }],
    { duration: 260, easing: 'ease-out' });
  a.onfinish = () => g.remove();
  a.oncancel = () => g.remove();
}

/** Called straight after render(), for the move that was just played. */
function animateMove(mv) {
  if (!mv || reduceMotion()) return;
  if (mv.captured) {
    // en passant takes a pawn that is not on the destination square
    const victim = mv.flags.includes('e') ? mv.to[0] + mv.from[1] : mv.to;
    fadeCapture(victim, mv.color === 'w' ? 'b' : 'w', mv.captured);
  }
  slide(mv.from, mv.to);
  if (mv.flags.includes('k') || mv.flags.includes('q')) {
    // castling moves the rook too; it follows a beat behind the king
    const rank = mv.color === 'w' ? '1' : '8';
    const [rf, rt] = mv.flags.includes('k') ? ['h', 'f'] : ['a', 'd'];
    slide(rf + rank, rt + rank, 60);
  }
}

/* ================= move input ================= */
boardEl.addEventListener('click', (ev) => {
  const sq = ev.target.closest('.sq');
  if (!sq || S.over || !S.connected) return;
  const name = sq.dataset.square;

  // completing a move onto a highlighted target
  const target = S.targets.find((m) => m.to === name);
  if (target) {
    const needsPromo = S.targets.filter((m) => m.to === name).some((m) => m.promotion);
    if (needsPromo) { S.pendingPromo = { from: S.selected, to: name }; showPromo(); return; }
    commitMove({ from: S.selected, to: name });
    return;
  }

  // picking a piece up (or putting it back down)
  const piece = S.game.get(name);
  if (piece && canPickUp(piece)) {
    if (S.selected === name) { clearSelection(); return; }
    S.selected = name;
    S.targets = S.game.moves({ square: name, verbose: true });
    render();
  } else {
    clearSelection();
  }
});

function clearSelection() {
  if (!S.selected && !S.targets.length) return;
  S.selected = null; S.targets = [];
  render();
}

function showPromo() {
  const wrap = $('#promo');
  const row = wrap.querySelector('.promo-row');
  row.innerHTML = '';
  for (const t of ['q', 'r', 'b', 'n']) {
    const b = el('button');
    b.appendChild(pieceSvg(S.myColor, t, 'promo-pc'));
    b.title = { q:'Queen', r:'Rook', b:'Bishop', n:'Knight' }[t];
    b.setAttribute('aria-label', b.title);
    b.onclick = () => {
      wrap.classList.add('hidden');
      const mv = { ...S.pendingPromo, promotion: t };
      S.pendingPromo = null;
      commitMove(mv);
    };
    row.appendChild(b);
  }
  wrap.classList.remove('hidden');
}

/** Apply my own move locally, then tell the opponent. */
function commitMove(mv) {
  let res;
  try { res = S.game.move(mv); }
  catch { clearSelection(); return; }     // chess.js throws on an illegal move
  S.selected = null; S.targets = [];
  send({ t: 'move', from: res.from, to: res.to, promotion: mv.promotion || null, fen: S.game.fen() });
  afterMove();
}

function afterMove() {
  const mv = S.game.history({ verbose: true }).slice(-1)[0];
  render();
  animateMove(mv);
  paintMoves();
  checkEnd();
}

/* ================= end of game ================= */
function checkEnd() {
  const g = S.game;
  if (!g.isGameOver()) return false;
  let title, text;
  if (g.isCheckmate()) {
    const loser = g.turn();                       // side to move is mated
    const iWon = loser !== S.myColor;
    title = iWon ? 'You won' : 'You lost';
    text = `Checkmate — ${loser === 'w' ? 'White' : 'Black'} is mated.`;
    S.result = iWon ? 'You won by checkmate' : 'Lost by checkmate';
  } else if (g.isStalemate()) {
    title = 'Draw'; text = 'Stalemate — no legal move, but no check.'; S.result = 'Draw — stalemate';
  } else if (g.isInsufficientMaterial()) {
    title = 'Draw'; text = 'Neither side has enough material to mate.'; S.result = 'Draw — insufficient material';
  } else if (g.isThreefoldRepetition()) {
    title = 'Draw'; text = 'The same position occurred three times.'; S.result = 'Draw — repetition';
  } else if (g.isDrawByFiftyMoves()) {
    title = 'Draw'; text = 'Fifty moves with no capture and no pawn move.'; S.result = 'Draw — fifty-move rule';
  } else {
    title = 'Draw'; text = 'The game is drawn.'; S.result = 'Draw';
  }
  endGame(title, text);
  return true;
}

function endGame(title, text) {
  S.over = true;
  S.selected = null; S.targets = [];
  $('#overTitle').textContent = title;
  $('#overText').textContent = text;
  $('#rematchNote').classList.add('hidden');
  $('#overlay').classList.remove('hidden');
  render();
}

/* ================= networking ================= */
function send(obj) {
  if (S.conn && S.conn.open) { try { S.conn.send(obj); } catch (e) { console.warn('send failed', e); } }
}

function setConn(state, label) {
  const c = $('#conn');
  c.classList.remove('ok', 'off');
  if (state) c.classList.add(state);
  $('#connText').textContent = label;
}

/** Everything that must be true once a DataConnection is open. */
function wireConnection(conn) {
  S.conn = conn;

  conn.on('open', () => {
    S.connected = true;
    setConn('ok', 'connected');
    showGame();
    if (S.hosting) {
      // The host is the one that decides the board, so it states the terms.
      send({ t: 'hello', v: PROTO, yourColor: S.myColor === 'w' ? 'b' : 'w', fen: S.game.fen() });
    }
    chatSys('Connected. Good luck.');
    render(); paintMoves();
  });

  conn.on('data', (msg) => handle(msg));

  conn.on('close', () => {
    S.connected = false;
    setConn('off', 'opponent disconnected');
    chatSys('Opponent disconnected.');
    paintStatus();
    if (!S.over) toast('Opponent disconnected. Keep this tab open — they can rejoin with the same code.', 6000);
    render();
  });

  conn.on('error', (e) => {
    console.warn('conn error', e);
    setConn('off', 'connection error');
  });
}

function handle(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'hello': {
      if (msg.v !== PROTO) {
        toast('Your opponent is running a different version of this page.', 6000);
        return;
      }
      S.myColor = msg.yourColor === 'b' ? 'b' : 'w';
      S.flipped = S.myColor === 'b';
      if (msg.fen) { try { S.game.load(msg.fen); } catch {} }
      render(); paintMoves();
      break;
    }
    case 'move': {
      // Both clients run the full rules, so a move from the opponent is
      // applied only if it is legal HERE. Their FEN is a cross-check, never
      // a source of truth: trusting it would let a modified client post any
      // position it liked straight onto our board.
      let res;
      try { res = S.game.move({ from: msg.from, to: msg.to, promotion: msg.promotion || undefined }); }
      catch { res = null; }
      if (!res) {
        toast('Your opponent sent a move that is not legal here \u2014 ignored.', 6000);
        chatSys('Rejected an illegal move from your opponent.');
        break;
      }
      if (msg.fen && msg.fen !== S.game.fen()) {
        // Same legal move, different resulting position: the two boards have
        // drifted. Say so plainly rather than silently picking a winner.
        chatSys('Warning: the two boards disagree on the position.');
      }
      afterMove();
      break;
    }
    case 'resign': {
      endGame('You won', 'Your opponent resigned.');
      S.result = 'Won — opponent resigned';
      break;
    }
    case 'chat': {
      if (typeof msg.text === 'string') chatLine('them', 'Opponent', msg.text.slice(0, 200));
      break;
    }
    case 'rematch': {
      S.rematchFromThem = true;
      if (S.rematchFromMe) startRematch(false);
      else {
        const n = $('#rematchNote');
        n.textContent = 'Your opponent wants a rematch.';
        n.classList.remove('hidden');
        $('#overlay').classList.remove('hidden');
        toast('Opponent offered a rematch.');
      }
      break;
    }
    case 'rematch-start': {
      applyRematch(msg.yourColor === 'b' ? 'b' : 'w');
      break;
    }
  }
}

/* ================= hosting / joining ================= */
function newPeer(id) {
  // No key or config passed: PeerJS 1.5 defaults to the free cloud broker and
  // ships both STUN and a TURN relay, which is what lets two machines on
  // different home networks reach each other.
  return id ? new Peer(id) : new Peer();
}

function host(attempt = 0) {
  lobbyError('');
  const pick = document.querySelector('input[name=side]:checked').value;
  S.myColor = pick === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : pick;
  S.flipped = S.myColor === 'b';
  S.hosting = true;

  const code = randomCode();
  S.code = code;
  const peer = newPeer(NS + code);
  S.peer = peer;

  $('#lobbyChoice').classList.add('hidden');
  $('#lobbyWait').classList.remove('hidden');
  $('#codeDisplay').textContent = code;

  peer.on('open', () => { $('#waitStatus').textContent = 'Waiting for your opponent…'; });

  peer.on('connection', (conn) => {
    if (S.conn && S.conn.open) { conn.close(); return; }   // one opponent only
    wireConnection(conn);
  });

  peer.on('error', (err) => {
    console.warn('peer error', err.type, err);
    if (err.type === 'unavailable-id' && attempt < 5) {
      peer.destroy();
      host(attempt + 1);                                   // code already taken
      return;
    }
    $('#lobbyWait').classList.add('hidden');
    $('#lobbyChoice').classList.remove('hidden');
    lobbyError(explain(err));
  });
}

function join(rawCode) {
  lobbyError('');
  const code = (rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) { lobbyError('That code looks too short. It is 5 characters.'); return; }
  S.hosting = false;
  S.code = code;

  const peer = newPeer();
  S.peer = peer;
  $('#lobbyChoice').classList.add('hidden');
  $('#lobbyWait').classList.remove('hidden');
  $('#codeDisplay').textContent = code;
  $('#btnCopyCode').classList.add('hidden');
  $('#waitStatus').textContent = 'Connecting…';

  peer.on('open', () => {
    // reliable:true matters. PeerJS defaults to reliable:false, which sets
    // ordered:false on the data channel -- moves could arrive out of order or
    // not at all. Chess cannot tolerate either.
    const conn = peer.connect(NS + code, { reliable: true, metadata: { v: PROTO } });
    wireConnection(conn);
    // PeerJS reports a bad id via peer 'error' (peer-unavailable), not here.
    setTimeout(() => {
      if (!S.connected) $('#waitStatus').textContent = 'Still trying… check the code is right.';
    }, 6000);
  });

  peer.on('error', (err) => {
    console.warn('peer error', err.type, err);
    $('#lobbyWait').classList.add('hidden');
    $('#lobbyChoice').classList.remove('hidden');
    $('#btnCopyCode').classList.remove('hidden');
    lobbyError(explain(err));
  });
}

function explain(err) {
  switch (err.type) {
    case 'peer-unavailable':
      return 'No game with that code. Check the code, and that your opponent still has their tab open.';
    case 'unavailable-id':
      return 'Could not claim a game code. Try again.';
    case 'browser-incompatible':
      return 'This browser does not support WebRTC. Try current Chrome, Edge, Firefox or Safari.';
    case 'disconnected':
    case 'network':
      return 'Lost contact with the matchmaking server. Check your connection and try again.';
    case 'server-error':
      return 'The public PeerJS broker is not responding. Try again in a minute.';
    case 'ssl-unavailable':
      return 'The matchmaking server refused a secure connection.';
    default:
      return 'Connection problem: ' + (err.type || 'unknown') + '.';
  }
}

/* ================= screens ================= */
function showGame() {
  $('#lobby').classList.add('hidden');
  $('#game').classList.remove('hidden');
}

/* ================= chat ================= */
function chatLine(cls, who, text) {
  const log = $('#chatLog');
  const d = el('div', cls);
  d.textContent = who ? `${who}: ${text}` : text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}
const chatSys = (t) => chatLine('sys', '', t);

/* ================= rematch ================= */
function startRematch(announce = true) {
  // Colours swap, so whoever had white gets black. The host declares it.
  const myNew = S.myColor === 'w' ? 'b' : 'w';
  if (S.hosting) send({ t: 'rematch-start', yourColor: myNew === 'w' ? 'b' : 'w' });
  applyRematch(myNew);
  if (announce) chatSys('New game.');
}

function applyRematch(myColor) {
  S.game = new Chess();
  S.myColor = myColor;
  S.flipped = myColor === 'b';
  S.over = false; S.result = null;
  S.selected = null; S.targets = []; S.pendingPromo = null;
  S.rematchFromMe = S.rematchFromThem = false;
  $('#overlay').classList.add('hidden');
  $('#promo').classList.add('hidden');
  $('#rematchNote').classList.add('hidden');
  render(); paintMoves();
  chatSys('New game — you are ' + (myColor === 'w' ? 'White' : 'Black') + '.');
}

/* ================= events ================= */
$('#btnHost').onclick = () => host();
$('#joinForm').onsubmit = (e) => { e.preventDefault(); join($('#joinCode').value); };
$('#btnCancelHost').onclick = () => { try { S.peer && S.peer.destroy(); } catch {} location.href = location.pathname; };

$('#btnCopyCode').onclick = async () => {
  const link = location.origin + location.pathname + '?join=' + S.code;
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied.');
  } catch {
    toast(link, 9000);          // clipboard blocked: show it so it can be copied by hand
  }
};

$('#btnFlip').onclick = () => { S.flipped = !S.flipped; render(); };

$('#btnResign').onclick = () => {
  if (S.over || !S.connected) return;
  if (!confirm('Resign this game?')) return;
  send({ t: 'resign' });
  endGame('You resigned', 'Your opponent wins.');
  S.result = 'Lost — resigned';
};

$('#btnLeave').onclick = () => {
  if (!confirm('Leave the game?')) return;
  try { S.conn && S.conn.close(); S.peer && S.peer.destroy(); } catch {}
  location.href = location.pathname;
};

$('#btnRematch').onclick = () => {
  S.rematchFromMe = true;
  if (S.rematchFromThem) { startRematch(); return; }
  send({ t: 'rematch' });
  const n = $('#rematchNote');
  n.textContent = 'Rematch offered — waiting for your opponent…';
  n.classList.remove('hidden');
};

$('#btnOverClose').onclick = () => $('#overlay').classList.add('hidden');

$('#chatForm').onsubmit = (e) => {
  e.preventDefault();
  const i = $('#chatInput');
  const text = i.value.trim();
  if (!text) return;
  send({ t: 'chat', text });
  chatLine('me', 'You', text);
  i.value = '';
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    clearSelection();
    $('#promo').classList.add('hidden');
    S.pendingPromo = null;
  }
});

$('#joinCode').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

/* ================= boot ================= */
// Debug/test handle. Safe by construction: each side validates every incoming
// move against its own rules engine, so local state is not a trust boundary --
// an edited client can only produce moves its opponent will reject.
window.__chess = { state: S, render, paintMoves, checkEnd, animateMove };

(function boot() {
  if (typeof Peer === 'undefined') {
    lobbyError('Could not load the networking library (js/vendor/peerjs.min.js).');
    return;
  }
  render();
  const code = new URLSearchParams(location.search).get('join');
  if (code) {
    $('#joinCode').value = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    join(code);
  }
})();
