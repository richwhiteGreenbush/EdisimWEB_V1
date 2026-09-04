// The app's first settings, and the screen they live on.
//
// This exists because of a gap rather than a feature: head bob, camera shake, arrival
// swoops, wind and a scrubbing sun together are a genuine vestibular hazard for a
// fraction of any class of thirty, and until now there was nowhere in this app -- no
// settings screen at all -- for a teacher or a student to turn any of it down. A missing
// screen, not a missing feature, and it belongs in front of the tenth thing that moves
// rather than behind it.
//
// NOT IndexedDB. Settings are per-MACHINE, not per-world: they are about this student's
// eyes and this Chromebook's speed, and they must survive Clear World, a loaded world
// file and an evicted database. localStorage is also synchronous, which matters because
// the very first frame has to know whether to animate.
//
// Every read is wrapped, because localStorage THROWS rather than returning null in a
// browser configured to block site data, and a settings read that throws at module load
// takes the whole app down with a blank page.

const KEY = 'edusim-settings';

// prefers-reduced-motion is the honest default: a student who has already told their
// operating system they do not want animation should not have to find a menu here to say
// it a second time. They can still override it in either direction below.
function systemPrefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  } catch {
    return false;
  }
}

const DEFAULTS = {
  // 'auto' follows the operating system; 'on' and 'off' are the student's own choice.
  motion: 'auto',
  // Wind is the only setting with a real performance argument behind it as well as a
  // comfort one: it is a custom shader program, and an older machine can simply not have it.
  wind: true,
  // Head bob and camera shake -- the two effects that move the VIEW rather than the world.
  // Split from `motion` deliberately: plenty of people are happy with a swaying tree and
  // unhappy with a swaying horizon, and those are not the same switch.
  cameraEffects: true,
  // The camera taking itself somewhere (Show me, the arrival swoop, a tour). Off means it
  // cuts instead, which is still usable -- unlike simply refusing to go.
  cameraMoves: true,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

const state = load();
const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // A browser blocking site data is not an error worth interrupting a lesson for. The
    // setting still applies for this session; it just will not be here tomorrow.
  }
}

export function getSetting(name) {
  return state[name];
}

export function setSetting(name, value) {
  if (!(name in DEFAULTS)) return;
  state[name] = value;
  persist();
  for (const fn of listeners) fn(name, value);
}

export function onSettingChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function allSettings() {
  return { ...state };
}

// THE ONE PREDICATE the rest of the app asks. Everything that moves checks this, and
// everything that checks it must still WORK when it is true -- reduced motion means
// arriving instantly, not not arriving.
export function reducedMotion() {
  if (state.motion === 'on') return false;
  if (state.motion === 'off') return true;
  return systemPrefersReducedMotion();
}

export function cameraEffectsOn() {
  return state.cameraEffects && !reducedMotion();
}

export function cameraMovesOn() {
  return state.cameraMoves && !reducedMotion();
}

export function windOn() {
  return state.wind && !reducedMotion();
}

// The rows the settings panel draws, described here rather than in the UI so that the
// DOM menu and any future in-scene VR panel cannot drift apart -- the same argument
// main.js's `menuActions` makes.
export const SETTING_ROWS = [
  {
    name: 'motion',
    label: 'Movement and animation',
    help: 'Wind, bobbing, things that pop and settle.',
    options: [
      { value: 'auto', label: 'Follow my device' },
      { value: 'on', label: 'On' },
      { value: 'off', label: 'Off' },
    ],
  },
  {
    name: 'cameraEffects',
    label: 'Head bob and shake',
    help: 'Movement of the view itself. Turn this off first if you feel unwell.',
    toggle: true,
  },
  {
    name: 'cameraMoves',
    label: 'Camera fly-arounds',
    help: 'Show me, guided tours and the swoop when a world opens. Off means it jumps straight there.',
    toggle: true,
  },
  {
    name: 'wind',
    label: 'Wind in the trees',
    help: 'Turn off if the world feels slow on this computer.',
    toggle: true,
  },
];
