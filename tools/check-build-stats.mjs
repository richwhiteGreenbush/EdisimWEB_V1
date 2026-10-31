// What leaves the app about a program, checked against the failure that matters: anything a
// student typed reaching the server. See src/BuildStats.js.
//
//   node tools/check-build-stats.mjs
import { objectLabel, programSignature } from '../src/BuildStats.js';

let failed = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${got}\n     want ${want}`}`);
};

const SECRET = 'Jane Doe 555-0100';
const say = { type: 'say', params: { text: SECRET } };
const spin = { type: 'rotate', params: { degrees: 123.45 } };

check('blocks keep their nesting', programSignature({
  program: [{ type: 'forever', params: {}, children: [spin] }, say],
}), 'forever(rotate),say');
check('a hat drops its text', programSignature({
  program: [{ type: 'whenSaid', params: { text: SECRET }, children: [say] }],
}), 'whenSaid(say)');
check('a long program is cut off', programSignature({
  program: Array.from({ length: 60 }, () => spin),
}).split(',').length, 41);
check('an empty program has no signature', programSignature({ program: [] }), '');

check('JavaScript lists known calls only', programSignature({
  programMode: 'js',
  programJs: `// ${SECRET}\nconst name = "${SECRET}";\nawait forever(async () => { await rotate(5); });\nawait say(\`rotate( ${SECRET}\`);\nsendHome(name);`,
}), 'js:rotate,forever,say');
check('words in comments and strings are not calls', programSignature({
  programMode: 'js',
  programJs: `// glide(1)\nconst a = 'moveUp(2)';`,
}), 'js:');

check('a model never gives its file name', objectLabel({ kind: 'gltf', files: [{ name: `${SECRET}.glb` }] }), 'model');
check('a panel never gives its address', objectLabel({ kind: 'web-browser', url: 'https://example.com/?q=secret' }), 'web-browser');
check('a shape names itself', objectLabel({ kind: 'primitive', shape: 'cube' }), 'shape:cube');
check('a world object names its builder', objectLabel({ kind: 'preset-prop', prop: 'sc-pay-stub' }), 'prop:sc-pay-stub');
check('a database model names its catalogue id', objectLabel({ kind: 'catalog-model', model: 'human-heart' }), 'catalog:human-heart');

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
