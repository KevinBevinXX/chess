import { launch } from './browser.mjs';
const U = process.env.SITE || 'http://127.0.0.1:8777/';
const b = await launch();
const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(U,{waitUntil:'networkidle'});
await p.screenshot({path:'shots/mobile-lobby.png'});
// drop into the board to check the grid at phone width
await p.evaluate(()=>{document.querySelector('#lobby').classList.add('hidden');
  document.querySelector('#game').classList.remove('hidden');
  const {state:S,render}=window.__chess; S.connected=true; render();});
await p.waitForTimeout(300);
await p.screenshot({path:'shots/mobile-board.png'});
const m = await p.evaluate(()=>({
  hScroll: document.documentElement.scrollWidth > window.innerWidth,
  scrollW: document.documentElement.scrollWidth, winW: window.innerWidth,
  board: Math.round(document.querySelector('#board').getBoundingClientRect().width),
  sq: Math.round(document.querySelector('.sq').getBoundingClientRect().width),
}));
console.log(JSON.stringify(m));
console.log('horizontal page scroll:', m.hScroll ? 'YES (bad)' : 'none');
console.log('tap target per square:', m.sq, 'px', m.sq>=40?'(>=40px, fine)':'(too small)');
if(errs.length) console.log('errors:',errs.join('; '));
await b.close();
