// Block-art designer: author at 2x2 sub-pixel resolution, pack into quadrant
// glyphs, verify the left-facing mirror with the EXTENDED mirror map.
const Q = { // mask TL,TR,BL,BR (bit 8,4,2,1) -> glyph
  0b0000:' ',0b1000:'▘',0b0100:'▝',0b0010:'▖',0b0001:'▗',
  0b1100:'▀',0b0011:'▄',0b1010:'▌',0b0101:'▐',0b1001:'▚',0b0110:'▞',
  0b1110:'▛',0b1101:'▜',0b1011:'▙',0b0111:'▟',0b1111:'█',
};
const MIRROR = { // ASCII (unused here) + block pairs
  '▌':'▐','▐':'▌','▘':'▝','▝':'▘','▖':'▗','▗':'▖',
  '▛':'▜','▜':'▛','▙':'▟','▟':'▙','▚':'▞','▞':'▚',
};
const RGB = { p:[217,119,87], o:[255,150,40], m:[200,70,70], k:[120,40,50], e:[120,230,255], w:[245,235,225] };
const fg = (k,ch)=>{const c=RGB[k]||[220,220,220];return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${ch}\x1b[0m`;};

// bitmap: array of strings, '#'/'X'=on, anything else=off. Must be even rows & cols.
function pack(bitmap){
  const h=bitmap.length, w=Math.max(...bitmap.map(r=>r.length));
  const rows=bitmap.map(r=>r.padEnd(w,' '));
  const out=[];
  for(let y=0;y<h;y+=2){
    let line='';
    for(let x=0;x<w;x+=2){
      const on=(yy,xx)=>{const ch=rows[yy]?.[xx]; return ch&&ch!==' '&&ch!=='.'?1:0;};
      const mask=(on(y,x)<<3)|(on(y,x+1)<<2)|(on(y+1,x)<<1)|on(y+1,x+1);
      line+=Q[mask];
    }
    out.push(line);
  }
  return out;
}
const mir=rows=>rows.map(row=>{let o='';for(let i=row.length-1;i>=0;i--)o+=MIRROR[row[i]]??row[i];return o;});
function show(name,bitmap,key){
  const R=pack(bitmap), L=mir(R), w=R[0].length;
  console.log(`\n=== ${name} ===  ${w}w × ${R.length}h chars  (${bitmap[0].length}x${bitmap.length} px)`);
  for(let i=0;i<R.length;i++){
    const r=[...R[i]].map(c=>fg(key,c)).join('');
    const l=[...L[i]].map(c=>fg(key,c)).join('');
    console.log('   '+R[i]+'      '+L[i]+'        '+r+'    '+l);
  }
  console.log('   GLYPH template (right-facing):');
  R.forEach(r=>console.log('     '+r.replace(/ /g,'·')));
}

// ---- PLAYER: Claude-style sunburst creature ----
// 14x10 px (7x5 chars). Rounded burst body, eye-holes, little feet, a top spark.
show('PLAYER — Claude sprite', [
  '......##......',
  '..#...##...#..',
  '..#.######.#..',
  '...########...',
  '..##.####.##..',  // eyes = holes
  '.############.',
  '.############.',
  '..##########..',
  '...##....##...',
  '...##....##...',
], 'p');

// ---- CHASER: corrupted/spiky burst, menacing ----
show('CHASER — corrupted sprite', [
  '#....##....#..',
  '.#..####..#...',
  '..########....',
  '.#.######.#...',
  '.##.####.##...',  // angry slit eyes
  '..########....',
  '.#.######.#...',
  '#...####...#..',
  '..#......#....',
  '.#........#...',
], 'm');
