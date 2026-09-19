<?php
declare(strict_types=1);

/*
 * The teacher layer on a world page: grade band, learning objective, standards, and a
 * link to the lesson plan and printable card that go with it.
 *
 * WHY THIS IS A TABLE IN A FILE AND NOT COLUMNS IN THE DATABASE. A world row is written
 * by whoever shared the world -- a student, usually -- and none of what is below is
 * theirs to write. These are editorial judgements about the thirty-odd worlds this
 * project ships, they change when the lesson plans change rather than when a world does,
 * and they belong in the repository beside the pages that carry them. Adding four columns
 * to `worlds` would also mean a migration, a form field nobody should fill in, and an
 * admin screen to edit it from, for data that has one author.
 *
 * IT IS KEYED BY SLUG, AND THAT IS THE LOAD-BEARING DECISION.
 *
 * Not by id: ids differ between this developer checkout and production, because they are
 * assigned in insert order and the two databases were seeded at different times. A table
 * keyed by id would silently attach Ancient Egypt's objective to Under the Sea on one of
 * the two, and there is no error to notice -- just a wrong sentence on a page.
 *
 * Not by theme either, tempting as it looks (a theme IS a world's own identity, and the
 * 41 seeded themes are unique). A world shared by a student inherits the theme of
 * whatever they built it in, so every `park`-themed classroom world would present itself
 * as The Park's lesson plan.
 *
 * A slug has neither problem. It is derived from the title by ewd_slugify(), so it is the
 * same string in every database seeded from the same list; it is UNIQUE by database
 * constraint; and ewd_unique_slug() suffixes a collision, so a student world called "The
 * Park" becomes `the-park-2` and correctly gets no teacher layer at all.
 *
 * ---------------------------------------------------------------------------
 * The standards are ALIGNMENTS, not a certification, and the page says so. CSTA codes
 * are the 1B (grades 3-5) and 2 (grades 6-8) bands, which is where these worlds sit.
 * NGSS codes are given only where the content has a genuine home; a world with no
 * natural NGSS match is given none rather than a stretched one, which is the same rule
 * docs/guide/teachers.html follows.
 */

/**
 * @return array{band:string,objective:string,standards:string,lesson:?string,card:?string}|null
 */
function ewd_teaching(string $slug): ?array
{
    static $table = null;
    if ($table === null) {
        $table = ewd_teaching_table();
    }
    return $table[$slug] ?? null;
}

function ewd_teaching_table(): array
{
    // `lesson` and `card` are page names under the Hands-On Guide, relative to
    // EWD_GUIDE_URL's directory. Only nine worlds have a written plan; the rest get the
    // guide's own hub, which is honest -- a link promising a lesson plan that turns out
    // to be a contents page is worse than no link.
    return [

        // --- the seven worlds with a full lesson plan and a student card -------------
        'the-park' => [
            'band' => 'Grades 3–8',
            'objective' => 'Explain how a designed landscape shapes the way people move through and use it, and use a repeat loop to animate part of a food web.',
            'standards' => 'NGSS 5-LS2-1, MS-LS2-3 · ISTE 1.5 Computational Thinker · CSTA 1B-AP-10, 2-AP-12',
            'lesson' => 'teachers.html', 'card' => 'park.html',
        ],
        'the-museum' => [
            'band' => 'Grades 3–8',
            'objective' => 'Identify the features of six art movements, and use a forever loop to turn a static sculpture into a kinetic one.',
            'standards' => 'ISTE 1.6 Creative Communicator, 1.5 Computational Thinker · CSTA 1B-AP-10, 1B-AP-12',
            'lesson' => 'teachers.html', 'card' => 'museum.html',
        ],
        'the-library' => [
            'band' => 'Grades 4–8',
            'objective' => 'Navigate a classification system by number, and write a loop that uses a sign change to send an object out and bring it back.',
            'standards' => 'ISTE 1.3 Knowledge Constructor · CSTA 1B-AP-10, 2-AP-12',
            'lesson' => 'teachers.html', 'card' => 'library.html',
        ],
        'the-moon' => [
            'band' => 'Grades 4–8',
            'objective' => 'Explain why the lunar sky is black and a flag cannot wave, and program a vehicle to follow a bounded route.',
            'standards' => 'NGSS 5-PS2-1, MS-ESS1-1 · ISTE 1.5 Computational Thinker · CSTA 1B-AP-10, 2-AP-12',
            'lesson' => 'teachers.html', 'card' => 'moon.html',
        ],
        'on-mars' => [
            'band' => 'Grades 5–8',
            'objective' => 'Identify what a human outpost must supply that Earth provides for free, and program a vehicle and an aircraft on different axes.',
            'standards' => 'NGSS MS-ETS1-1, MS-ESS1-3 · ISTE 1.4 Innovative Designer · CSTA 1B-AP-10, 2-AP-12',
            'lesson' => 'teachers.html', 'card' => 'mars.html',
        ],
        'dinosaur-island' => [
            'band' => 'Grades 3–8',
            'objective' => 'Explain how fossils form and what a trackway reveals, then animate an animal’s behaviour rather than just its position.',
            'standards' => 'NGSS 3-LS4-1, MS-LS4-1 · ISTE 1.3 Knowledge Constructor · CSTA 1B-AP-10, 2-AP-12',
            'lesson' => 'teachers.html', 'card' => 'dinosaur.html',
        ],
        'fantastic-voyage' => [
            'band' => 'Grades 4–8',
            'objective' => 'Locate the major organs and describe what connects them, then use loops and timing to model a real biological rate.',
            'standards' => 'NGSS 4-LS1-1, MS-LS1-3 · ISTE 1.3 Knowledge Constructor · CSTA 1B-AP-10, 2-AP-17',
            'lesson' => 'teachers.html', 'card' => 'voyage.html',
        ],

        // --- the workshop worlds ------------------------------------------------------
        'my-world' => [
            'band' => 'Grades 2–8',
            'objective' => 'Decompose a familiar object into simple solids and rebuild it to a stated scale, on an empty field with nothing to build around.',
            'standards' => 'NGSS 3-5-ETS1-2, MS-ETS1-2 · ISTE 1.4 Innovative Designer · CSTA 1B-AP-11, 2-AP-13',
            'lesson' => 'teachers.html', 'card' => 'builder.html',
        ],
        'javascript-basics' => [
            'band' => 'Grades 5–8',
            'objective' => 'Read a working JavaScript program, predict what changing one value will do, and edit it — five lessons taught by machines that are already running.',
            'standards' => 'ISTE 1.5 Computational Thinker · CSTA 2-AP-11, 2-AP-12, 2-AP-17',
            'lesson' => 'teachers.html', 'card' => 'javascript.html',
        ],
        'robot-challenge-world' => [
            'band' => 'Grades 3–8',
            'objective' => 'Write, run and debug five programs of increasing difficulty — a sequence, a loop, nested loops, mixed block families, and two objects talking to each other.',
            'standards' => 'ISTE 1.5 Computational Thinker · CSTA 1B-AP-10, 1B-AP-15, 2-AP-12, 2-AP-17',
            'lesson' => 'teachers.html', 'card' => 'coding.html',
        ],
        'a-bug-s-life' => [
            'band' => 'Grades 3–8',
            'objective' => 'Build and program at 60× scale, where a grass blade is a tower — five building challenges down one side of the avenue and five coding challenges down the other.',
            'standards' => 'NGSS 3-LS4-3 · ISTE 1.4 Innovative Designer, 1.5 Computational Thinker · CSTA 1B-AP-10, 1B-AP-11',
            'lesson' => 'teachers.html', 'card' => null,
        ],
        'whimsical-world' => [
            'band' => 'Grades 2–6',
            'objective' => 'Meet the block palette through five challenges, the last of which is opening a program somebody else wrote and changing one number in it.',
            'standards' => 'ISTE 1.5 Computational Thinker · CSTA 1B-AP-10, 1B-AP-12',
            'lesson' => 'teachers.html', 'card' => 'coding.html',
        ],

        // --- science ------------------------------------------------------------------
        'volcanoes-rocks' => [
            'band' => 'Grades 4–8',
            'objective' => 'Read a cut-away volcano’s plumbing — chamber, conduit, dikes and sill — and identify twelve rocks by how they formed.',
            'standards' => 'NGSS 4-ESS1-1, MS-ESS2-1, MS-ESS2-2 · ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'inside-an-animal-cell' => [
            'band' => 'Grades 5–8',
            'objective' => 'Name the organelles of an animal cell and say what each one does, walking inside a nucleus cut open to show it.',
            'standards' => 'NGSS MS-LS1-2 · ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'inside-a-twister' => [
            'band' => 'Grades 3–8',
            'objective' => 'Describe how a tornado forms and what it does to a building, and open the program that is already turning the funnel to change its speed.',
            'standards' => 'NGSS 3-ESS2-1, MS-ESS2-5 · ISTE 1.5 Computational Thinker · CSTA 1B-AP-12',
            'lesson' => null, 'card' => null,
        ],
        'the-water-cycle' => [
            'band' => 'Grades 3–6',
            'objective' => 'Trace a drop of water through evaporation, condensation, precipitation and collection, and program the rain.',
            'standards' => 'NGSS 5-ESS2-1, MS-ESS2-4 · ISTE 1.5 Computational Thinker · CSTA 1B-AP-10',
            'lesson' => null, 'card' => null,
        ],
        'under-the-sea' => [
            'band' => 'Grades 3–8',
            'objective' => 'Identify the animals and corals of a tropical reef and describe how each one is suited to where it lives, thirty feet underwater.',
            'standards' => 'NGSS 3-LS4-3, MS-LS2-1 · ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'great-barrier-reef' => [
            'band' => 'Grades 3–8',
            'objective' => 'Compare a healthy reef with a bleached one and explain what causes the difference.',
            'standards' => 'NGSS MS-LS2-4, MS-ESS3-5 · ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'a-rabbit-s-den' => [
            'band' => 'Grades K–4',
            'objective' => 'Describe what an animal needs from where it lives, in a warren cut open to show the chambers.',
            'standards' => 'NGSS K-ESS3-1, 3-LS4-3 · ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],

        // --- space --------------------------------------------------------------------
        'solar-system-walk' => [
            'band' => 'Grades 3–8',
            'objective' => 'Walk the solar system at scale and describe how far apart the planets really are, rather than how a diagram draws them.',
            'standards' => 'NGSS 5-ESS1-2, MS-ESS1-3 · ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'the-constellations' => [
            'band' => 'Grades 3–8',
            'objective' => 'Find eight constellations by their real positions and magnitudes, and explain why they cannot all be in the sky at once.',
            'standards' => 'NGSS 5-ESS1-1, MS-ESS1-1 · ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'telescope-observatory' => [
            'band' => 'Grades 4–8',
            'objective' => 'Explain what a telescope dome is for, and program the dome and the telescope to turn together so the slit stays in front of the tube.',
            'standards' => 'NGSS MS-ESS1-1 · ISTE 1.5 Computational Thinker · CSTA 1B-AP-10, 2-AP-12',
            'lesson' => null, 'card' => null,
        ],
        'space-station-survival' => [
            'band' => 'Grades 4–8',
            'objective' => 'Work out what a crew in orbit needs that Earth supplies free, and build five of those systems as models.',
            'standards' => 'NGSS MS-ETS1-1, MS-ETS1-2 · ISTE 1.4 Innovative Designer',
            'lesson' => null, 'card' => 'builder.html',
        ],

        // --- history and places --------------------------------------------------------
        'ancient-egypt' => [
            'band' => 'Grades 4–8',
            'objective' => 'Describe how the pyramids and the Sphinx were built and weathered, and read sunk relief and a six-mineral painted palette.',
            'standards' => 'ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'ancient-pompeii' => [
            'band' => 'Grades 4–8',
            'objective' => 'Explain what buried Pompeii and what that preserved, and read a Roman street as evidence of how people lived.',
            'standards' => 'NGSS MS-ESS2-2, MS-ESS3-2 · ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'the-colosseum' => [
            'band' => 'Grades 4–8',
            'objective' => 'Explain how a Roman arch carries load, and judge the scale of a building against your own height by walking through its ground arcade.',
            'standards' => 'NGSS MS-ETS1-1 · ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'machu-picchu' => [
            'band' => 'Grades 4–8',
            'objective' => 'Describe how Inca mortarless masonry and agricultural terraces work, and why a doorway narrows as it rises.',
            'standards' => 'NGSS MS-ETS1-1 · ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'the-taj-mahal' => [
            'band' => 'Grades 4–8',
            'objective' => 'Identify symmetry and proportion in Mughal architecture, and describe how the plan is organised about a single axis.',
            'standards' => 'ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'red-square' => [
            'band' => 'Grades 4–8',
            'objective' => 'Describe what makes St Basil’s nine domes different from one another, and read a public square as a piece of design.',
            'standards' => 'ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'big-ben-westminster' => [
            'band' => 'Grades 4–8',
            'objective' => 'Describe Gothic Revival architecture and how a clock tower is put together, from the ground and from across the river.',
            'standards' => 'ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'cologne-cathedral' => [
            'band' => 'Grades 4–8',
            'objective' => 'Explain how a Gothic cathedral stands up — buttress, vault and pointed arch — by walking round and inside one.',
            'standards' => 'NGSS MS-ETS1-1 · ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'ellis-island' => [
            'band' => 'Grades 4–8',
            'objective' => 'Describe what happened in the Registry Room and what a person arriving in 1907 would have experienced.',
            'standards' => 'ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'the-u-s-capitol' => [
            'band' => 'Grades 4–8',
            'objective' => 'Identify the parts of the Capitol and say what each branch of government does in it.',
            'standards' => 'ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'da-vinci-s-studio' => [
            'band' => 'Grades 4–8',
            'objective' => 'Explain how Leonardo’s machines were meant to work, and find the pegs that make the self-propelled cart a programmable one.',
            'standards' => 'NGSS MS-ETS1-1 · ISTE 1.4 Innovative Designer · CSTA 1B-AP-10',
            'lesson' => null, 'card' => null,
        ],
        'delta-river-boat' => [
            'band' => 'Grades 3–8',
            'objective' => 'Describe how a paddle steamer works and what a river carried in the age of steam.',
            'standards' => 'NGSS MS-ETS1-1 · ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        '1940-s-new-york' => [
            'band' => 'Grades 4–8',
            'objective' => 'Read a 1949 street as evidence — the cars, the marquees, the shopfronts — and say what has and has not changed.',
            'standards' => 'ISTE 1.3 Knowledge Constructor',
            'lesson' => null, 'card' => null,
        ],
        'the-neighborhood' => [
            'band' => 'Grades K–5',
            'objective' => 'Describe the parts of a town and what each building is for, and program a trolley to run up and down the street.',
            'standards' => 'ISTE 1.5 Computational Thinker · CSTA 1B-AP-10, 1B-AP-12',
            'lesson' => null, 'card' => 'coding.html',
        ],
        'seattle-center' => [
            'band' => 'Grades 3–8',
            'objective' => 'Describe what a world’s fair leaves behind, and write three programs for three exhibits — a loop, nested loops, and a sequence.',
            'standards' => 'ISTE 1.5 Computational Thinker · CSTA 1B-AP-10, 2-AP-12',
            'lesson' => null, 'card' => 'coding.html',
        ],
        'greenbush-science-center' => [
            'band' => 'Grades 3–8',
            'objective' => 'Walk into a real exhibit hall and compare fifteen science exhibits, then build one of your own outside it.',
            'standards' => 'ISTE 1.3 Knowledge Constructor, 1.4 Innovative Designer',
            'lesson' => null, 'card' => 'builder.html',
        ],

        // --- story ---------------------------------------------------------------------
        'alice-in-wonderland' => [
            'band' => 'Grades 2–6',
            'objective' => 'Retell a scene from the book by finding the characters in it, then open the Cheshire Cat’s program and make him fade.',
            'standards' => 'ISTE 1.6 Creative Communicator, 1.5 Computational Thinker · CSTA 1B-AP-12',
            'lesson' => null, 'card' => 'coding.html',
        ],
        'simon-in-the-land-of-chalk-drawings' => [
            'band' => 'Grades K–5',
            'objective' => 'Draw a shape by hand and watch it inflate into a solid, then program a marker to draw one for you.',
            'standards' => 'ISTE 1.6 Creative Communicator, 1.5 Computational Thinker · CSTA 1B-AP-10',
            'lesson' => null, 'card' => 'coding.html',
        ],
    ];
}

/**
 * "Grades 3–8" -> "8-14", for schema.org's typicalAgeRange.
 *
 * The bands are written for teachers and a search engine wants years, so this is the one
 * place the two vocabularies meet. US grade N is typically age N+5 at the start of the
 * year; kindergarten is 5. An unparseable band returns the widest honest answer rather
 * than a guess, because a wrong age range is worse than a broad one.
 */
function ewd_age_range(string $band): string
{
    $map = static function (string $g): ?int {
        $g = trim($g);
        if (strcasecmp($g, 'K') === 0) {
            return 5;
        }
        return ctype_digit($g) ? (int)$g + 5 : null;
    };

    // The dash is an en dash in the table, not a hyphen.
    if (preg_match('/Grades?\s+([K0-9]+)\s*[–-]\s*([K0-9]+)/iu', $band, $m)) {
        $lo = $map($m[1]);
        $hi = $map($m[2]);
        if ($lo !== null && $hi !== null) {
            return $lo . '-' . $hi;
        }
    }
    return '5-14';
}
