// A v4 UUID, on any origin.
//
// `crypto.randomUUID()` is a SECURE-CONTEXT API: it exists on https and on localhost, and
// is `undefined` on a plain http origin that is not localhost. Every id in this app goes
// through it -- every placed record, every block instance, every primitive -- so on an
// insecure origin the app did not degrade, it threw `crypto.randomUUID is not a function`
// during boot and rendered a blank page.
//
// That is not hypothetical: it is exactly what happened the first time the built app was
// served from http://edusim3dweb.com/app/ so that "Open this world in Edusim" could fetch
// same-origin. Nothing about the feature was wrong; the app simply could not run there.
//
// `crypto.getRandomValues()` is NOT secure-context-only and is available everywhere this
// app runs, so the fallback is a real random v4 rather than a weaker Math.random() id --
// which matters, because these ids are the keys records are stored and looked up under.
export function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Version 4, variant 1 -- the two fields that make this a well-formed v4 rather than 16
  // random bytes with hyphens in it.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}`
    + `-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}
