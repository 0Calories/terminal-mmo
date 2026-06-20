const Q={0b0000:' ',0b1000:'▘',0b0100:'▝',0b0010:'▖',0b0001:'▗',0b1100:'▀',0b0011:'▄',0b1010:'▌',0b0101:'▐',0b1001:'▚',0b0110:'▞',0b1110:'▛',0b1101:'▜',0b1011:'▙',0b0111:'▟',0b1111:'█'};
const MIRROR={'▌':'▐','▐':'▌','▘':'▝','▝':'▘','▖':'▗','▗':'▖','▛':'▜','▜':'▛','▙':'▟','▟':'▙','▚':'▞','▞':'▚'};
const RGB={p:[217,119,87],m:[200,70,70],e:[120,230,255],g:[190,240,90]};
const fg=(k,ch)=>{const c=RGB[k]||[220,220,220];return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${ch}\x1b[0m`;};
function pack(bm){const h=bm.length,w=Math.max(...bm.map(r=>r.length)),rows=bm.map(r=>r.padEnd(w,' '));const out=[];for(let y=0;y<h;y+=2){let l='';for(let x=0;x<w;x+=2){const on=(a,b)=>{const c=rows[a]?.[b];return c&&c!=='.'&&c!==' '?1:0;};l+=Q[(on(y,x)<<3)|(on(y,x+1)<<2)|(on(y+1,x)<<1)|on(y+1,x+1)];}out.push(l);}return out;}
const mir=r=>r.map(row=>{let o='';for(let i=row.length-1;i>=0;i--)o+=MIRROR[row[i]]??row[i];return o;});
function show(name,bm,key,eyeBm,eyeKey){
  const R=pack(bm),L=mir(R);
  // optional eye overlay (separate color)
  let ER=null,EL=null; if(eyeBm){ER=pack(eyeBm);EL=mir(ER);}
  console.log(`\n=== ${name} ===  ${R[0].length}w × ${R.length}h`);
  for(let i=0;i<R.length;i++){
    const colr=(grid,ekey,row,erow)=>[...row].map((c,j)=>{const ec=erow?.[j]; return ec&&ec!==' '?fg(ekey,ec):fg(key,c);}).join('');
    console.log('   '+R[i]+'    '+L[i]+'      '+colr(R,eyeKey,R[i],ER?.[i])+'   '+colr(L,eyeKey,L[i],EL?.[i]));
  }
  console.log('   template: '+R.map(r=>r.replace(/ /g,'·')).join('  '));
}

// ===== PLAYER candidates =====
// P1: clean rounded Claude-burst blob, faceless, little feet
show('P1 player — round burst', [
  '.....####.....',
  '...########...',
  '..##########..',
  '.############.',
  '.############.',
  '..########..',
  '..########..',
  '...######...',
  '...##..##...',
  '...##..##...',
],'p');

// P2: burst with eyes (2x2 holes) + feet
show('P2 player — burst + eyes', [
  '.....####.....',
  '...########...',
  '..##########..',
  '.############.',
  '.##..####..##.',
  '.##..####..##.',
  '..########..',
  '...######...',
  '...##..##...',
  '...##..##...',
],'p');

// P3: radial sunburst (Claude logo feel) — diamond + spokes
show('P3 player — sunburst', [
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

// ===== CHASER candidates =====
// C1: spiky corrupted burst, angular, slit eyes
show('C1 chaser — spiked burst', [
  '#....##....#.',
  '.#..####..#..',
  '..########...',
  '.##########..',
  '##..####..##.',
  '.##########..',
  '..########...',
  '.#..####..#..',
  '#...####...#.',
  '...##..##....',
],'m',[
  '.............',
  '.............',
  '.............',
  '.............',
  '..#.....#....',
  '..#.....#....',
  '.............',
  '.............',
  '.............',
  '.............',
],'g');

// C2: low gnashing brute — wide jaw
show('C2 chaser — gnasher', [
  '..#......#...',
  '.###....###..',
  '.##########..',
  '############.',
  '##..####..##.',
  '############.',
  '#.#.#.#.#.#..',
  '.#.#.#.#.#...',
  '..#....#.....',
  '.#......#....',
],'m',[
  '.............',
  '.............',
  '.............',
  '.............',
  '##......##...',
  '.............',
  '.............',
  '.............',
  '.............',
  '.............',
],'g');
