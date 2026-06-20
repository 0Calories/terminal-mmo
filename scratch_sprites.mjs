// Scratch: lay out sprite candidates, verify width===7, preview render + mirror.
const SENTINEL = '·';
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '/': '\\', '\\': '/', '`': "'", "'": '`' };

function split(art) {
  const lines = art.split('\n');
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  const width = lines.reduce((w, l) => Math.max(w, l.length), 0);
  return lines.map((l) => l.padEnd(width, ' '));
}
function toSpace(rows) { return rows.map((r) => r.replaceAll(SENTINEL, ' ')); }
function mirror(rows) {
  return rows.map((row) => {
    let out = '';
    for (let i = row.length - 1; i >= 0; i--) out += MIRROR[row[i]] ?? row[i];
    return out;
  });
}
function frame(rows, label) {
  const w = rows[0].length;
  const top = '┌' + '─'.repeat(w) + '┐';
  const bot = '└' + '─'.repeat(w) + '┘';
  const body = rows.map((r) => '│' + r + '│').join('\n');
  return `${label} (w=${w})\n${top}\n${body}\n${bot}`;
}
function show(name, art) {
  const rows = split(art);
  const widths = [...new Set(rows.map((r) => r.length))];
  const R = toSpace(rows);
  const L = toSpace(mirror(rows));
  console.log(`\n=== ${name} ===  rows=${rows.length} widths=${widths.join(',')}`);
  // print right and left side by side
  const a = frame(R, 'right →').split('\n');
  const b = frame(L, '← left').split('\n');
  const h = Math.max(a.length, b.length);
  for (let i = 0; i < h; i++) console.log((a[i] ?? '').padEnd(16) + '    ' + (b[i] ?? ''));
}

// ---------------- PLAYER candidates ----------------
show('PLAYER current', `
··___··
·/o o\\·
( -.- )
·\\___/·
·/   \\·`);

show('PLAYER A — Adventurer (humanoid + blade)', `
·(o◡o)·
·/[┃]\\·
(=|#|=)
··┃·┃··
·d┛·┗b·`);

show('PLAYER B — Mascot Knight (round, sword)', `
·.━━━.·
(o ◡ o)
·)███(╱
·(███)·
·╱···╲·`);

show('PLAYER C — Caped Warrior (ASCII-safe)', `
·(o-o)·
/|[#]|\\
··|=|··
··| |··
·_/ \\_·`);

show('PLAYER D — Stout hero (ASCII-safe)', `
·,---.·
·|o.o|·
(/|"|\\)
·\\_-_/·
·_J L_·`);

// ---------------- CHASER candidates ----------------
show('CHASER current', `
·,---.·
·|x x|·
( >w< )
·\`-v-'·
·/   \\·`);

show('CHASER A — Snapping crawler (ASCII-safe)', `
·/\\_/\\·
·>X X<·
{ /VV\\ }
·\\m-m/·
·^^·^^·`);

show('CHASER B — Floating skull-wisp', `
·.---.·
(x___x)
·)vvv(·
··\\^/··
···v···`);

show('CHASER C — Spider-stalker (ASCII-safe)', `
\\·/·\\·/
·(X_X)·
/·>w<·\\
·//·\\\\·
·^^·^^·`);

show('CHASER D — Brute (angular, heavy)', `
·┏━━┓·
·┫>w<┣
·┃▚▚┃·
·┗┳┳┛·
··╹·╹·`);
