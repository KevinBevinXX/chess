import { launch, URL } from './browser.mjs';
const b = await launch();
async function shot(name, opts, fen, sel){
  const p = await (await b.newContext({viewport:{width:900,height:900},deviceScaleFactor:2,...opts})).newPage();
  await p.goto(URL,{waitUntil:'networkidle'});
  await p.evaluate(([fen,sel])=>{
    document.querySelector('#lobby').classList.add('hidden');
    document.querySelector('#game').classList.remove('hidden');
    const {state:S,render,paintMoves}=window.__chess;
    S.game.load(fen); S.connected=true; S.myColor=S.game.turn(); S.flipped=false;
    if(sel){S.selected=sel;S.targets=S.game.moves({square:sel,verbose:true});}
    render(); paintMoves();
  },[fen,sel]);
  await p.waitForTimeout(400);
  await p.locator('.board-wrap').screenshot({path:`shots/${name}.png`});
  const t = await p.evaluate(()=>document.querySelectorAll('.sq .target').length);
  console.log(name,'targets drawn:',t);
}
// white to move, bishop selected -> dots; black king in check -> pulse ring
await shot('pieces-targets',{}, 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 5','c4');
await shot('pieces-dark',{colorScheme:'dark'},'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4',null);
await b.close();
