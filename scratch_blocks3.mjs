const Q={0b0000:' ',0b1000:'▘',0b0100:'▝',0b0010:'▖',0b0001:'▗',0b1100:'▀',0b0011:'▄',0b1010:'▌',0b0101:'▐',0b1001:'▚',0b0110:'▞',0b1110:'▛',0b1101:'▜',0b1011:'▙',0b0111:'▟',0b1111:'█'};
const MIRROR={'▌':'▐','▐':'▌','▘':'▝','▝':'▘','▖':'▗','▗':'▖','▛':'▜','▜':'▛','▙':'▟','▟':'▙','▚':'▞','▞':'▚'};
const RGB={p:[217,119,87],m:[200,70,70],e:[120,230,255],g:[180,240,90]};
const fg=(k,ch)=>{const c=RGB[k]||[220,220,220];return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${ch}\x1b[0m`;};
function pack(bm){const w=Math.max(...bm.map(r=>r.length)),rows=bm.map(r=>r.padEnd(w,' '));const out=[];for(let y=0;y<bm.length;y+=2){let l='';for(let x=0;x<w;x+=2){const on=(a,b)=>{const c=rows[a]?.[b];return c&&c!=='.'&&c!==' '?1:0;};l+=Q[(on(y,x)<<3)|(on(y,x+1)<<2)|(on(y+1,x)<<1)|on(y+1,x+1)];}out.push(l);}return out;}
function cgrid(bm){const w=Math.max(...bm.map(r=>r.length)),rows=bm.map(r=>r.padEnd(w,' '));const out=[];for(let y=0;y<bm.length;y+=2){let l='';for(let x=0;x<w;x+=2){let k='.';for(const[a,b]of[[y,x],[y,x+1],[y+1,x],[y+1,x+1]]){const c=rows[a]?.[b];if(c&&c!=='.'&&c!==' ')k=c;}l+=k;}out.push(l);}return out;}
const mir=r=>r.map(row=>{let o='';for(let i=row.length-1;i>=0;i--)o+=MIRROR[row[i]]??row[i];return o;});
function show(name,bm,key,eyeBm){
  const R=pack(bm),L=mir(R);
  const cg=eyeBm?cgrid(eyeBm):null,cgL=cg?cg.map(r=>[...r].reverse().join('')):null;
  console.log(`\n=== ${name} ===  ${R[0].length}w × ${R.length}h`);
  for(let i=0;i<R.length;i++){
    const colr=(grid,row,crow)=>[...row].map((c,j)=>{const k=crow&&crow[j]!=='.'?crow[j]:key;return fg(k,c);}).join('');
    console.log('   '+colr(R,R[i],cg?.[i])+'   '+colr(L,L[i],cgL?.[i])+'      '+R[i]);
  }
  console.log('   GLYPH: `'); R.forEach(r=>console.log(r.replace(/ /g,'·'))); console.log('`');
  if(cg){console.log('   COLORS: `'); cg.forEach(r=>console.log(r.replace(/\./g,'·'))); console.log('`');}
}

// ===== PLAYER: rounded Claude blob with feet =====
show('PLAYER — Claude blob', [
  '....######....',
  '..##########..',
  '.############.',
  '.############.',
  '.############.',
  '.############.',
  '..##########..',
  '...########...',
  '...##....##...',
  '...##....##...',
],'p');

// ===== PLAYER alt: sunburst (the Claude mark) =====
show('PLAYER alt — Claude spark', [
  '......##......',
  '..#...##...#..',
  '...#.####.#...',
  '....######....',
  '.##.######.##.',
  '.##.######.##.',
  '....######....',
  '...#.####.#...',
  '..#...##...#..',
  '......##......',
],'p');

// ===== CHASER: spiked corrupted burst, green eyes =====
show('CHASER — glitch burst', [
  '#.....##.....#',
  '.#...####...#.',
  '..##########..',
  '.############.',
  '.##..####..##.',
  '.############.',
  '..##########..',
  '.#...####...#.',
  '#..#......#..#',
  '.#..........#.',
],'m',[
  '..............',
  '..............',
  '..............',
  '..............',
  '.gg......gg...',  // eyes overlay (approx; will align to cells)
  '..............',
  '..............',
  '..............',
  '..............',
  '..............',
]);

// ===== CHASER alt: gnashing maw =====
show('CHASER alt — maw', [
  '#....##....#..',
  '.#..####..#...',
  '.##########...',
  '############..',
  '.##########...',
  '#.#.#.#.#.#...',
  '.#.#.#.#.#....',
  '.##########...',
  '.#........#...',
  '#..........#..',
],'m',[
  '..............',
  '..............',
  '..............',
  '..gg....gg....',
  '..............',
  '..............',
  '..............',
  '..............',
  '..............',
  '..............',
]);
