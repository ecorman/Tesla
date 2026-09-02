// test-ra.cjs — verifica la normalización de rotondas y la voz/pitido de
// salida usando EXACTAMENTE las funciones de nav.html (extraídas del propio
// archivo) y la secuencia real de pasos que devuelve OSRM (Glorieta de Bilbao).
'use strict';
const fs = require('fs');
const html = fs.readFileSync('nav.html', 'utf8');

function extractFn(name) {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fn not found: ' + name);
  let j = html.indexOf('{', i);
  let depth = 0;
  for (; j < html.length; j++) {
    const c = html[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return html.slice(i, j);
}

const code = ['normalizeRoundabouts', 'isRAtype', 'ordinalEs', 'raTextFor', 'stepName', 'checkVoice']
  .map(extractFn).join('\n');

let events = [];
let voiceFlags = {};
const S = { voiceMode: 'voice' }; // voz + pitidos
// eslint-disable-next-line no-eval
eval(code + `
function speak(t){events.push('SPEAK: '+t);}
function navBeep(k){events.push('BEEP: '+k);}
this.__norm = normalizeRoundabouts;
this.__cv = checkVoice;
this.__isRA = isRAtype;
this.__raText = raTextFor;
`);

const data = eval('this');
const normalizeRoundabouts = data.__norm;
const checkVoice = data.__cv;
const isRAType = data.__isRA;
const raTextFor = data.__raText;

/* ---------- snapshot real de OSRM (Glorieta de Bilbao, Madrid) ---------- */
const rawSteps = [
  // El paso «turn right» es largo (300 m) de propósito: así la ENTRADA de la
  // rotonda queda a 590 m del inicio y el aviso lejano «En quinientos metros»
  // (banda 450–550 m antes de la entrada) sí llega a dispararse.
  { distance: 290, duration: 20, name: 'Calle del Cardenal Cisneros', maneuver: { type: 'depart', modifier: 'straight' } },
  { distance: 300, duration: 25, name: 'Calle de Eloy Gonzalo', maneuver: { type: 'turn', modifier: 'right' } },
  { distance: 53, duration: 6, name: 'Calle de San Bernardo', maneuver: { type: 'rotary', modifier: 'straight', exit: 2 } },
  { distance: 102, duration: 10, name: 'Calle de San Bernardo', maneuver: { type: 'exit-rotary', modifier: 'slight right', exit: 2 } },
  { distance: 0, duration: 0, name: 'Calle de San Bernardo', maneuver: { type: 'arrive', modifier: 'left' } },
];

const failures = [];
function check(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { failures.push(msg); console.log('  ✗ ' + msg); }
}

console.log('== 1. normalización ==');
const norm = normalizeRoundabouts(JSON.parse(JSON.stringify(rawSteps)));
check(norm.length === 4, '4 pasos tras fusionar (se absorbe exit-rotary)');
const ra = norm[2];
check(ra.maneuver.type === 'rotary' && ra.maneuver.exit === 2, 'rotonda con salida 2');
check(ra.distance === 155, 'distancia fusionada = anillo(53)+calle(102) = 155 m (cumDist consistente)');
check(ra._ra.ringLen === 53, 'ringLen = 53 m (solo el anillo)');
check(String(ra.name).includes('San Bernardo'), 'nombre = calle de salida');
check(ra._ra.text === 'tome la segunda salida hacia Calle de San Bernardo', 'texto de voz correcto');
check(!norm.some(s => /^exit-/.test(s.maneuver.type)), 'no queda ningún paso exit-* suelto');

/* ---------- simulación de conducción (paso del navTick replicado) ---------- */
console.log('== 2. conducción por la rotonda (anuncios y pitido) ==');
const cumDist = [];
{ let c = 0; for (const s of norm) { c += s.distance || 0; cumDist.push(c); } }
let maneuverIdx = 0;
voiceFlags = {};
events = [];
const beepsAt = {};

for (let carDist = 0; carDist <= 620; carDist += 10) {
  let step = null, stepDist = Infinity;
  for (let i = maneuverIdx; i < norm.length; i++) {
    const dAlong = (cumDist[i] || 0) - carDist;
    if (dAlong <= 0 && i === maneuverIdx) { maneuverIdx++; voiceFlags = {}; break; }
    if (i === maneuverIdx) { step = norm[i]; stepDist = dAlong; break; }
  }
  if (!step) continue;
  // lookahead (igual que navTick)
  let ra = null;
  for (let i = maneuverIdx; i < norm.length; i++) {
    const st = norm[i];
    if (!isRAType(st.maneuver.type)) continue;
    const cumStart = (cumDist[i] || 0) - (st.distance || 0);
    const dStart = cumStart - carDist;
    st._raf = st._raf || {};
    const ringLen = (st._ra && st._ra.ringLen != null) ? st._ra.ringLen : (st.distance || 0);
    ra = { s: st, dStart, dExit: dStart + ringLen, text: (st._ra && st._ra.text) || raTextFor(st) };
    break;
  }
  const before = events.length;
  checkVoice(step, stepDist, ra);
  for (let k = before; k < events.length; k++) {
    if (events[k].startsWith('BEEP:')) beepsAt[events[k]] = (beepsAt[events[k]] || 0) + 1;
  }
  if (carDist % 100 === 0) {
    // depuración opcional
  }
}

const speaks = events.filter(e => e.startsWith('SPEAK:'));
const beeps = events.filter(e => e.startsWith('BEEP:'));
console.log('  eventos: ' + speaks.length + ' voz / ' + beeps.length + ' pitidos');
check(speaks.some(s => s.includes('En quinientos metros, en la rotonda, tome la segunda salida hacia Calle de San Bernardo')), 'aviso a 500 m ANTES de la entrada');
check(speaks.some(s => s.startsWith('SPEAK: En la rotonda, tome la segunda salida')), 'aviso a 200 m ANTES de la entrada');
check(!speaks.some(s => s.includes('Gire a la derecha')), 'NO se dice «Gire a la derecha» (ni al entrar a la rotonda)');
check(!speaks.some(s => s.includes(' ahora')), 'sin «… ahora» duplicado en los 230 m previos');
check((beepsAt['BEEP: near'] || 0) === 1, 'un único pitido de aproximación (200 m)');
check((beepsAt['BEEP: roundabout-exit'] || 0) === 1, 'pitido de salida de rotonda: exactamente 1');
// el pitido de salida debe sonar cuando queda <=40 m del punto de salida del anillo
const exitIdx = events.findIndex(e => e === 'BEEP: roundabout-exit');
check(exitIdx >= 0, 'pitido de salida emitido');
// sin voces dentro del anillo después del pitido (solo el pitido)
const afterExit = events.slice(exitIdx + 1);
check(!afterExit.some(e => e.startsWith('SPEAK:')), 'sin anuncios de voz dentro del anillo tras el pitido');

console.log('== 3. regresión: paso normal sin rotondas ==');
const norm2 = normalizeRoundabouts([
  { distance: 200, duration: 15, name: 'Calle de Alcalá', maneuver: { type: 'depart', modifier: 'straight' } },
  { distance: 350, duration: 25, name: 'Gran Vía', maneuver: { type: 'turn', modifier: 'left' } },
  { distance: 0, duration: 0, name: '', maneuver: { type: 'arrive', modifier: 'straight' } },
]);
check(norm2.length === 3, 'pasos normales intactos');
voiceFlags = {}; events = [];
checkVoice(norm2[1], 500, null);
check(events.some(e => e.startsWith('SPEAK: En quinientos metros, Gire a la izquierda')), 'aviso 500 m normal intacto');
voiceFlags = {}; events = [];
checkVoice(norm2[1], 40, null);
check(events.some(e => e.includes(' ahora')), '«ahora» + pitido en giro normal intacto');
check(events.some(e => e === 'BEEP: near'), 'pitido normal intacto');

console.log(failures.length ? '\nFAIL: ' + failures.length + ' fallos' : '\nPASS — todo correcto');
process.exit(failures.length ? 1 : 0);