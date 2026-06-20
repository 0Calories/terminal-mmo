// Scratch v2: finalists with color grids, true-color preview, mirror + dim check.
const SENTINEL = '·';
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '/': '\\', '\\': '/', '`': "'", "'": '`' };

const RGB = {
  p: [255, 150, 40],   // player body (orange, existing)
  s: [255, 224, 181],  // skin / face
  i: [150, 170, 190],  // iron / steel (armor, weapon)
  e: [120, 230, 255],  // eye glint / accent
  m: [220, 90, 90],    // monster body (red, existing)
  k: [120, 40, 50],    // monster dark (claws, shadow)
  g: [190, 240, 90],   // monster eye glow (sickly)
  d: [90, 70, 60],     // outline / dark detail
};
const fg = (k, ch) => { const c = RGB[k] || [200,200,200]; return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${ch}\x1b[0m`; };

function split(art) {
  const lines = art.split('\n');
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const w = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return lines.map((l) => l.padEnd(w, ' '));
}
const toSpace = (rows) => rows.map((r) => r.replaceAll(SENTINEL, ' '));
const mirror = (rows) => rows.map((row) => { let o=''; for (let i=row.length-1;i>=0;i--) o+=MIRROR[row[i]]??row[i]; return o; });
const reverse = (rows) => rows.map((row) => { let o=''; for (let i=row.length-1;i>=0;i--) o+=row[i]; return o; });

function colored(glyphRows, colorRows, def) {
  return glyphRows.map((r, y) => {
    let out = '';
    for (let x = 0; x < r.length; x++) {
      const ch = r[x];
      if (ch === ' ') { out += ' '; continue; }
      let k = colorRows ? colorRows[y][x] : def;
      if (k === SENTINEL || k === ' ' || k === undefined) k = def;
      out += fg(k, ch);
    }
    return out;
  });
}

function show(name, glyph, def, colors) {
  const g = split(glyph);
  const widths = [...new Set(g.map((r) => r.length))];
  let cRows = null;
  if (colors) {
    const c = split(colors);
    const cw = [...new Set(c.map((r) => r.length))];
    if (c.length !== g.length || cw[0] !== widths[0] || cw.length>1)
      console.log(`!! COLOR MISMATCH for ${name}: glyph ${widths}x${g.length} vs color ${cw}x${c.length}`);
    cRows = c;
  }
  const gR = toSpace(g), gL = toSpace(mirror(g));
  const cR = cRows ? cRows : null, cL = cRows ? reverse(cRows) : null;
  const R = colored(gR, cR, def), L = colored(gL, cL, def);
  console.log(`\n=== ${name} ===  ${widths.join('/')}w × ${g.length}h`);
  for (let i = 0; i < g.length; i++) console.log('   ' + R[i] + '        ' + L[i]);
}

// ===================== PLAYER =====================
show('PLAYER cur', `
··___··
·/o o\\·
( -.- )
·\\___/·
·/   \\·`, 'p');

show('PLAYER 1 — Mascot+ (round, friendly, color)', `
·.---.·
(o   o)
)·___·(
·\\   /·
·/   \\·`, 'p', `
·sssss·
psssssp
pssssss
·ppppp·
·i···i·`);

show('PLAYER 2 — Warrior (helmet, crest, boots)', `
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

show('PLAYER 3 — Ranger (hood + facing crest)', `
·//^\\\\·
·(o-o)·
·{|=|}·
·/| |\\·
·_J·L_·`, 'p', `
·ipppi·
·sssss·
·ppppp·
·ppppp·
·ii·ii·`);

// ===================== CHASER =====================
show('CHASER cur', `
·,---.·
·|x x|·
( >w< )
·\`-v-'·
·/   \\·`, 'm');

show('CHASER 1 — Snapper (low fanged biter)', `
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

show('CHASER 2 — Wisp (floating skull)', `
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

show('CHASER 3 — Stalker (clawed spider-thing)', `
\\·/·\\·/
·(X-X)·
/·>w<·\\
·/d·d\\·
·^···^·`, 'm', `
k·k·k·k
·mgggm·
k·mmm·k
·kk·kk·
·k···k·`);
