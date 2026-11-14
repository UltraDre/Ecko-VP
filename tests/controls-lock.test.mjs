// Runtime test: the left-side control lock and its locked tap/gesture behavior.
// Boots the real index.html + script.js in jsdom with media-element stubs.
import fs from 'node:fs';
import path from 'node:path';
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = await import('jsdom'));
} catch {
  console.error('This test needs jsdom:  npm install --no-save jsdom');
  process.exit(2);
}

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

let problems = 0;
const check = (name, cond, extra = '') => {
  if (!cond) problems++;
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond ? '' : '  ' + extra}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const logs = { errors: [] };
const vc = new VirtualConsole();
vc.on('error', (...a) => logs.errors.push(a.map(String).join(' ')));
vc.on('jsdomError', (e) => logs.errors.push(String(e && e.message || e)));

const dom = new JSDOM(html, {
  url: 'https://example.com/app/index.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;
const { document } = window;
const $ = (s) => document.querySelector(s);

/* ---------- media / browser APIs jsdom lacks ---------- */
Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
  configurable: true,
  get() { return this._paused !== false; },
  set(v) { this._paused = !!v; },
});
Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', {
  configurable: true, get() { return this._duration ?? NaN; },
});
Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
  configurable: true,
  get() { return this._currentTime ?? 0; },
  set(v) { this._currentTime = Number(v) || 0; this.dispatchEvent(new window.Event('timeupdate')); },
});
window.HTMLMediaElement.prototype.play = function play() {
  this._paused = false;
  this.dispatchEvent(new window.Event('play'));
  return Promise.resolve();
};
window.HTMLMediaElement.prototype.pause = function pause() {
  this._paused = true;
  this.dispatchEvent(new window.Event('pause'));
};
window.HTMLMediaElement.prototype.load = function load() {};
Object.defineProperty(window.HTMLMediaElement.prototype, 'buffered', {
  configurable: true, get() { return { length: 0, start: () => 0, end: () => 0 }; },
});
Object.defineProperty(window.HTMLMediaElement.prototype, 'textTracks', {
  configurable: true, get() { return { length: 0, addEventListener() {}, removeEventListener() {} }; },
});
window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
window.HTMLDialogElement.prototype.close = function close(v) {
  this.open = false; this.returnValue = v ?? '';
  this.dispatchEvent(new window.Event('close'));
};
window.MediaMetadata = class MediaMetadata { constructor(o) { Object.assign(this, o); } };
window.navigator.mediaSession = { setActionHandler() {}, playbackState: 'none' };
window.navigator.storage = undefined;
window.navigator.serviceWorker = undefined;
window.matchMedia = (q) => ({
  matches: /max-width:\s*1079px/.test(q),
  media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
});
window.Element.prototype.scrollIntoView = function scrollIntoView() {};
window.URL.createObjectURL = () => 'blob:https://example.com/' + Math.random().toString(36).slice(2);
window.URL.revokeObjectURL = () => {};
window.confirm = () => true;
window.AbortSignal.timeout = (ms) => {
  const c = new window.AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
};

window.eval(`${script}\n;window.__app = { Controls, Gestures, Player, Shell, Menus };`);
const run = (expr) => window.eval(`(() => { const { Controls, Gestures, Player, Shell, Menus } = window.__app; return (${expr}); })()`);

const stage = $('#playerStage');
const lock = $('#btnControlsLock');
const bar = $('#controlsBar');
const click = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const touch = (type, x = 300, y = 200) => {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  const t = { identifier: 1, clientX: x, clientY: y, target: stage };
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [t] });
  Object.defineProperty(ev, 'changedTouches', { value: [t] });
  stage.dispatchEvent(ev);
};
const tap = () => { touch('touchstart'); touch('touchend'); };
const pointer = (type, props = {}) => {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 300, clientY: 200 }, props);
  stage.dispatchEvent(ev);
};

await wait(800);
console.log('\n— lock follows the full control bar —');
check('app booted without errors', logs.errors.length === 0, logs.errors.join(' | '));
check('controls start hidden', bar.classList.contains('is-hidden'));
check('lock is hidden while controls are hidden', lock.hidden === true);
click(stage);
await wait(400);
check('revealing controls reveals the lock', !bar.classList.contains('is-hidden') && lock.hidden === false);
check('unlocked lock offers to lock', lock.getAttribute('aria-pressed') === 'false' && lock.getAttribute('aria-label') === 'Lock controls');

// A paused, never-played item shows the center play button; locking must hide it.
run('Player.current = { id: "x", title: "X" }');
run('Player._hasPlayed = false');
run('Player.updatePlayButton()');
check('center play is visible before locking', $('#bigPlay').hidden === false);
$('#btnSpeed').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
run('Shell.openPanel()');
await wait(20);
check('speed menu and panel are open before locking', $('#speedMenu').hidden === false && $('#sidebar').classList.contains('open'));

console.log('\n— locking hides chrome and consumes touch gestures —');
click(lock);
check('body enters locked mode', document.body.classList.contains('controls-locked'));
check('stage announces locked instructions', /locked/i.test(stage.getAttribute('aria-label')));
check('locking hides the full control bar', bar.classList.contains('is-hidden') && bar.inert === true);
check('locking hides the lock itself', lock.hidden === true);
check('header is inert while locked', $('.app-header').inert === true);
check('locking closes the speed menu', $('#speedMenu').hidden === true);
check('locking closes the playlist panel', !$('#sidebar').classList.contains('open'));
check('locking hides the center play button', $('#bigPlay').hidden === true);

tap();
check('first locked tap reveals only the lock', lock.hidden === false && bar.classList.contains('is-hidden'));
check('revealed lock offers to unlock', lock.getAttribute('aria-pressed') === 'true' && lock.getAttribute('aria-label') === 'Unlock controls');
tap();
check('second locked tap hides the lock again', lock.hidden === true && bar.classList.contains('is-hidden'));
await wait(850); // let the synthetic-touch click suppression window expire
click(stage);
check('locked mouse click reveals only the lock', lock.hidden === false && bar.classList.contains('is-hidden'));

run('Controls.setBarVisible(true)');
check('a programmatic/keyboard reveal cannot bypass the lock', lock.hidden === false && bar.classList.contains('is-hidden'));
run('Controls.setBarVisible(false)');

const video = $('#video');
video._duration = 600;
video.currentTime = 100;
video.volume = 0.5;
video._paused = false;
const pausedBefore = video.paused;
tap(); tap(); // two quick locked taps cycle the lock, not playback
check('quick locked taps do not toggle playback', video.paused === pausedBefore);
check('quick locked taps end with the lock hidden', lock.hidden === true);

touch('touchstart', 100, 150);
touch('touchmove', 220, 150);
touch('touchend', 220, 150);
check('locked horizontal swipe does not seek', video.currentTime === 100, String(video.currentTime));
touch('touchstart', 200, 150);
touch('touchmove', 200, 80);
touch('touchend', 200, 80);
check('locked vertical swipe does not change volume', Math.abs(video.volume - 0.5) < 0.001, String(video.volume));
check('locked swipes do not reveal the lock', lock.hidden === true);

pointer('pointerdown');
await wait(430);
check('locked press-and-hold does not force 2x speed', video.playbackRate === 1, String(video.playbackRate));
pointer('pointerup');

console.log('\n— unlocking restores the controls —');
video._paused = true;
run('Player._hasPlayed = false');
tap();
check('lock can be revealed again after gestures', lock.hidden === false);
click(lock);
check('unlock leaves locked mode', !document.body.classList.contains('controls-locked'));
check('stage instructions are restored', !/locked/i.test(stage.getAttribute('aria-label')));
check('unlock restores the full control bar', !bar.classList.contains('is-hidden') && bar.inert === false);
check('unlock restores the open-lock button', lock.hidden === false && lock.getAttribute('aria-pressed') === 'false');
check('unlock restores the header', $('.app-header').inert === false);
check('unlock restores the center play button', $('#bigPlay').hidden === false);

click(lock);
tap();
click(lock);
check('lock/unlock can be repeated', !document.body.classList.contains('controls-locked') && !bar.classList.contains('is-hidden') && lock.hidden === false);
check('no uncaught runtime errors', logs.errors.length === 0, logs.errors.join(' | '));

window.close();
console.log(problems ? `\n${problems} problem(s) found` : '\nAll controls-lock checks passed');
process.exit(problems ? 1 : 0);
