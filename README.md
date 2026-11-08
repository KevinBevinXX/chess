# Chess

Two-player online chess that runs entirely on GitHub Pages. One player starts a
game and gets a five-character code; the other enters it, and the two browsers
play directly to each other.

**Play:** https://kevinbevinxx.github.io/multiplayer-chess/

## How two computers reach each other without a server

GitHub Pages serves static files and nothing else, so there is no backend here
to relay moves. The two browsers connect **peer to peer over WebRTC** instead,
using [PeerJS](https://peerjs.com). A public broker introduces the two tabs to
one another, then drops out of the way — after that the moves travel directly
between the players.

That matters for a practical reason: it works between two machines on
*different* networks, not just two tabs on one desk. PeerJS 1.5 ships a STUN
server and a TURN relay by default, and the TURN relay is what carries traffic
when a home router will not allow a direct connection.

Two consequences worth knowing:

- **The host's tab is the game.** There is no copy on a server, so if the host
  closes the tab the game is gone. The code only works while that tab is open.
- **Nothing is stored anywhere.** No accounts, no database, no move logs. When
  both tabs close, nothing is left.

The data channel is opened with `reliable: true`. PeerJS defaults that to
`false`, which also sets `ordered: false` — fine for video, wrong for chess,
where a dropped or reordered move desynchronises the board.

## Rules

Move generation and all the end conditions come from
[chess.js](https://github.com/jhlywa/chess.js), which handles castling, en
passant, promotion, check, checkmate, stalemate, the fifty-move rule, threefold
repetition and insufficient material.

**Both players run the full rules independently.** A move is applied on the
receiving machine only if it is legal there; an opponent's claimed position is
never loaded on trust. An edited client therefore cannot push an illegal move
or an invented position onto the other board — it can only send something the
other side rejects.

## Playing

- Start a game, then send the code or the invite link.
- Click a piece to see its legal moves, click a square to play.
- Promotion asks which piece you want rather than always giving a queen.
- Resign, offer a rematch (colours swap), flip the board, and chat.
- `Esc` cancels a selection. The board works on a phone.

## Running it locally

Any static file server will do — there is no build step:

```sh
python3 -m http.server 8777    # then open http://127.0.0.1:8777/
```

## Tests

Automated, driving real browsers:

```sh
test/serve.sh &                # serve the site on :8777
cd test && npm install
node rules.mjs                 # chess rules, through the real UI
node twoplayer.mjs             # two browsers, really connected
```

`rules.mjs` plays real positions through the interface and checks en passant,
both castlings, castling out of an attacked path, promotion, checkmate,
stalemate, insufficient material, the fifty-move rule, threefold repetition,
and that pinned pieces and out-of-turn moves are refused.

`twoplayer.mjs` opens two independent browsers, connects them over the live
broker and checks that moves, castling, chat, resignation and rematch all cross
the connection, and that each player sees the board from their own side.

The tests need a Chromium; they will use a Playwright download or a system
Chrome automatically, or set `CHROME=/path/to/chrome`.

## Layout

```
index.html          markup
css/style.css       all styling
js/app.js           board, rules integration, networking
js/vendor/          chess.js and peerjs, committed so the page has no CDN
test/               browser tests
```

Both libraries are vendored rather than loaded from a CDN, so the page has no
third-party runtime dependency and keeps working if a CDN does not.

## Licence

chess.js and peerjs are BSD-2-Clause and MIT respectively; their licences are
in `js/vendor/`.
