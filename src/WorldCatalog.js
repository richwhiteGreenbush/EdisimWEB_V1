import { wordsOf, fieldScore } from './models/catalog.js';

// The data half of the World Database panel: fetching the gallery's list and searching it. No
// DOM, so a node tool can check it.
//
// THE LIST COMES FROM THE SERVER, unlike the models. A model is a table in the bundle because
// it has a builder in the bundle; a world is a file in the gallery, and the gallery's ids differ
// between databases, so a copy in the bundle would point at the wrong worlds. catalog.php is on
// this page's own origin for the reason WorldLink.js gives.

// The rail. A world carries several tags, so it can be under several of these, which is why
// the counts beside them do not add up to All. Worlds tagged with anything else are still
// found by searching for the tag.
export const WORLD_TOPICS = [
  { key: 'starter', label: 'Start Here', icon: '🌱' },
  { key: 'science', label: 'Science', icon: '🔬' },
  { key: 'coding', label: 'Coding', icon: '🧩' },
  { key: 'nature', label: 'Nature', icon: '🌿' },
  { key: 'animals', label: 'Animals', icon: '🦋' },
  { key: 'space', label: 'Space', icon: '🪐' },
  { key: 'history', label: 'History', icon: '🏛️' },
  { key: 'building', label: 'Building', icon: '🔨' },
];

/**
 * The published list. Throws with a sentence worth showing a student.
 *
 * A 200 that is not JSON is a failure, not an empty list: it is what a captive portal, a
 * filter's block page or a Vite dev server with no gallery behind it all send.
 */
export async function fetchWorldCatalog(url) {
  let response;
  try {
    response = await fetch(url, { credentials: 'omit' });
  } catch {
    throw new Error('Could not reach the World Database.');
  }
  if (!response.ok) throw new Error('The World Database could not send its list.');
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Could not read the World Database.');
  }
  if (!Array.isArray(data?.worlds)) throw new Error('Could not read the World Database.');
  return data;
}

function searchIndex(world) {
  if (world.searchWords) return world.searchWords;
  const index = {
    title: wordsOf(world.title),
    titleText: world.title.toLowerCase(),
    tags: wordsOf(`${world.tags.join(' ')} ${world.place}`),
    people: wordsOf(`${world.creator} ${world.group}`),
    body: wordsOf(`${world.description} ${world.objective}`),
  };
  Object.defineProperty(world, 'searchWords', { value: index, enumerable: false });
  return index;
}

// Two words, each in the title: "under the", "new york". Browsing never shows a secret world
// and neither does one word, or a search for "sea" would hand over a door the student is
// meant to find by walking round the back of a building.
function revealsSecret(words, index) {
  return words.length >= 2 && words.every((word) => fieldScore(word, index.title, 1) > 0);
}

/** Best match first. With no query, the order the server sent, which is most opened first. */
export function searchWorlds(query, worlds) {
  const words = wordsOf(query);
  if (!words.length) return worlds.filter((world) => !world.secret);
  const scored = [];
  for (const world of worlds) {
    const index = searchIndex(world);
    if (world.secret && !revealsSecret(words, index)) continue;
    let score = 0;
    let everyWord = true;
    for (const word of words) {
      const best = Math.max(
        fieldScore(word, index.title, 10),
        index.titleText.includes(word) ? 6 : 0,
        fieldScore(word, index.tags, 4),
        fieldScore(word, index.people, 3),
        word.length >= 3 ? fieldScore(word, index.body, 1) : 0,
      );
      if (!best) { everyWord = false; break; }
      score += best;
    }
    if (everyWord) scored.push({ world, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.world);
}
