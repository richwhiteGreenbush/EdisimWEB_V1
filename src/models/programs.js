import { makeBlock } from '../BlockDefs.js';
import { forever, repeat, wait, forward, up, both, rotate, goHome } from '../BlockKit.js';

// Starter programs a model can arrive carrying. They ship idle (`programIdle`), with a green
// play arrow, so nothing in a student's world starts moving until they ask it to; the point of
// each one is to be opened and changed. They go through BlockKit and so through makeBlock(),
// which is why a builder here runs once per placement: two objects must not share block ids.
//
// A negative `rotate` turns right, measured in The Neighborhood. Everything moves along the
// object's own +Z, which is the way every model in this table is built to face.
const glide = (feet, seconds) => makeBlock('glide', { feet, seconds });

export const STARTER_PROGRAMS = {
  spin: () => [forever(rotate(1))],
  spinSlow: () => [forever(rotate(0.4))],
  swimCircle: () => [forever(forward(0.3), rotate(1.5))],
  buzzCircle: () => [forever(forward(0.2), rotate(4))],
  hop: () => [
    repeat(3, repeat(6, both(0.6, 0.5)), repeat(6, both(0.6, -0.5)), wait(0.3)),
    wait(1),
    goHome(),
  ],
  liftOff: () => [repeat(150, up(0.5)), wait(2), goHome()],
  driveSquare: () => [forever(glide(15, 2.5), rotate(-90))],
  shuttle: () => [forever(glide(20, 4), wait(1), glide(-20, 4), wait(1))],
  flyHop: () => [repeat(80, both(0.5, 0.05)), repeat(80, both(0.5, -0.05)), wait(2), goHome()],
};
