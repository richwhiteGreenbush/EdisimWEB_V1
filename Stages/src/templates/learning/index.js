// The learning projects (per Rich, 2026-11-28): grade 3-12 lessons in science, maths, history, art and
// language, each a project to play, read and change. Grouped by subject, one file per group, all
// written as data with ./kit.js. They join the official GALLERY after the original eleven.
import { galleryEntry } from './kit.js';
import featured from './featured.js';
import earth from './earth.js';
import life from './life.js';
import physical from './physical.js';
import math from './math.js';
import humanities from './humanities.js';

export const LEARNING_SPECS = [...featured, ...earth, ...life, ...physical, ...math, ...humanities];
export const LEARNING = LEARNING_SPECS.map(galleryEntry);
export { SUBJECTS } from './kit.js';
