const SENTINEL = '·';
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '/': '\\', '\\': '/', '`': "'", "'": '`' };
const RGB = { p:[255,150,40], s:[255,224,181], i:[150,170,190], e:[120,230,255], m:[220,90,90], k:[120,40,50], g:[190,240,90] };
const fg = (k,ch) => { const c=RGB[k]||[200,200,200]; return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${ch}\x1b[0m`; };
function split(art){ const l=art.split('\n'); while(l.length&&l[0].trim()==='')l.shift(); while(l.length&&l[l.length-1].trim()==='')l.pop(); const w=l.reduce((m,x)=>Math.max(m,x.length),0); return l.map(x=>x.padEnd(w,' ')); }
const toSpace=r=>r.map(x=>x.replaceAll(SENTINEL,' '));
const mir=r=>r.map(row=>{let o='';for(let i=row.length-1;i>=0;i--)o+=MIRROR[row[i]]??row[i];return o;});
const rev=r=>r.map(row=>{let o='';for(let i=row.length-1;i>=0;i--)o+=row[i];return o;});
function col(g,c,d){return g.map((r,y)=>{let o='';for(let x=0;x<r.length;x++){const ch=r[x];if(ch===' '){o+=' ';continue;}let k=c?c[y][x]:d;if(k===SENTINEL||k===' '||k===undefined)k=d;o+=fg(k,ch);}return o;});}
function show(name,glyph,def,colors){const g=split(glyph),w=[...new Set(g.map(r=>r.length))];let c=null;if(colors){c=split(colors);const cw=[...new Set(c.map(r=>r.length))];if(c.length!==g.length||cw[0]!==w[0]||cw.length>1)console.log(`!! MISMATCH ${name}`);}
  const R=col(toSpace(g),c,def),L=col(toSpace(mir(g)),c?rev(c):null,def);
  console.log(`\n=== ${name} ===  ${w.join('/')}w×${g.length}h`);
  console.log('   plain →     plain ←     color →     color ←');
  for(let i=0;i<g.length;i++) console.log('   '+toSpace(g)[i]+'     '+toSpace(mir(g))[i]+'     '+R[i]+'   '+L[i]); }

show('PLAYER A — Warrior', `
·,vvv.·
·|o-o|·
(/|H|\\)
·\\===/·
·_J·L_·`, 'p', `
·eeeee·
·sippi·
ppiiipp
·ppppp·
·ii·ii·`);

show('PLAYER B — Mascot+', `
·.---.·
·|o o|·
·\\·u·/·
(·===·)
·/···\\·`, 'p', `
·sssss·
·seees·
·sssss·
psssssp
·ii·ii·`);

show('CHASER A — Snapper', `
·^···^·
(O···O)
{>VVV<}
·\\WWW/·
·d·d·d·`, 'm', `
·g···g·
mgmmmgm
kmmmmmk
·kkkkk·
·k·k·k·`);

show('CHASER B — Wisp', `
·.---.·
(o___o)
·)WWW(·
··\\m/··
···v···`, 'm', `
·mmmmm·
gmmmmmg
·kkkkk·
··mmm··
···m···`);
