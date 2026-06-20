const Q={0:' ',8:'▘',4:'▝',2:'▖',1:'▗',12:'▀',3:'▄',10:'▌',5:'▐',9:'▚',6:'▞',14:'▛',13:'▜',11:'▙',7:'▟',15:'█'};
const MIRROR={'▌':'▐','▐':'▌','▘':'▝','▝':'▘','▖':'▗','▗':'▖','▛':'▜','▜':'▛','▙':'▟','▟':'▙','▚':'▞','▞':'▚'};
const RGB={p:[217,119,87],e:[150,235,255],m:[210,75,70],g:[170,240,95],u:[168,120,225],a:[255,200,80],d:[70,45,55]};
const fg=(k,ch)=>{const c=RGB[k]||[225,225,225];return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${ch}\x1b[0m`;};
const sym=h=>h+[...h].reverse().join('');           // left half -> full palindrome
const S=rows=>rows.map(sym);
function pack(bm){const w=Math.max(...bm.map(r=>r.length)),rows=bm.map(r=>r.padEnd(w,' '));const out=[];for(let y=0;y<bm.length;y+=2){let l='';for(let x=0;x<w;x+=2){const on=(a,b)=>{const c=rows[a]?.[b];return c&&c!=='.'&&c!==' '?1:0;};l+=Q[(on(y,x)<<3)|(on(y,x+1)<<2)|(on(y+1,x)<<1)|on(y+1,x+1)];}out.push(l);}return out;}
function cgrid(bm){const w=Math.max(...bm.map(r=>r.length)),rows=bm.map(r=>r.padEnd(w,' '));const out=[];for(let y=0;y<bm.length;y+=2){let l='';for(let x=0;x<w;x+=2){let k='.';for(const[a,b]of[[y,x],[y,x+1],[y+1,x],[y+1,x+1]]){const c=rows[a]?.[b];if(c&&c!=='.'&&c!==' ')k=c;}l+=k;}out.push(l);}return out;}
const mir=r=>r.map(row=>{let o='';for(let i=row.length-1;i>=0;i--)o+=MIRROR[row[i]]??row[i];return o;});
function show(name,bm,key,eyeBm){
  const R=pack(bm),L=mir(R);
  const cg=eyeBm?cgrid(eyeBm):null,cgL=cg?cg.map(r=>[...r].reverse().join('')):null;
  console.log(`\n=== ${name} ===  ${R[0].length}w × ${R.length}h chars`);
  for(let i=0;i<R.length;i++){
    const cr=[...R[i]].map((c,j)=>fg(cg&&cg[i][j]!=='.'?cg[i][j]:key,c)).join('');
    const cl=[...L[i]].map((c,j)=>fg(cgL&&cgL[i][j]!=='.'?cgL[i][j]:key,c)).join('');
    console.log('   '+cr+'    '+cl);
  }
  console.log('   --- glyph template ---');
  R.forEach(r=>console.log('   '+r.replace(/ /g,'·')));
  if(cg){console.log('   --- colors ('+key+' default) ---');cg.forEach(r=>console.log('   '+r.replace(/\./g,'·')));}
}

// =================== PLAYER — Claude buddy (11w x 8h) ===================
show('PLAYER — Claude buddy', S([
  '..........#',  // peak
  '.........##',
  '.......####',
  '.....######',
  '....#######',
  '...########',
  '..#########',
  '..#########',
  '..#########',
  '..#########',
  '...########',
  '....#######',
  '......#####',
  '....####...',  // feet
  '....####...',
  '....####...',
]), 'p', S([
  '...........',
  '...........',
  '...........',
  '...........',
  '...........',
  '...........',
  '.....##....',  // eyes
  '.....##....',
  '.....##....',
  '...........',
  '...........',
  '...........',
  '...........',
  '...........',
  '...........',
  '...........',
]));

// =================== CHASER — glitch beast (12w x 7h) ===================
show('CHASER — glitch beast', S([
  '#...........',  // horns
  '.#..........',
  '..#......###',
  '...#...#####',
  '....########',
  '..##########',
  '.###########',
  '.###########',
  '..##########',
  '...#########',
  '#.#.#.#.#.#.',  // fangs
  '..#...#...#.',  // claws
  '...#...#...#',
  '...#...#...#',
]), 'm', S([
  '............',
  '............',
  '............',
  '............',
  '............',
  '....###.....',  // eyes
  '....###.....',
  '....###.....',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
]));

// =================== SHOOTER — floating sentinel (10w x 7h) ===================
show('SHOOTER — eye sentinel', S([
  '.........#',  // antenna
  '........##',
  '......####',
  '....######',
  '..########',
  '.#########',
  '##########',  // fins at edge
  '.#########',
  '..########',
  '....######',
  '......####',
  '.........#',  // tail wisp
  '........#.',
  '.......#..',
]), 'u', S([
  '..........',
  '..........',
  '..........',
  '..........',
  '..........',
  '.......###',  // big single eye
  '.......###',
  '.......###',
  '..........',
  '..........',
  '..........',
  '..........',
  '..........',
  '..........',
]));
