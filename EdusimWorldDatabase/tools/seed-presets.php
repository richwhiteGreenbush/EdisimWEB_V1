<?php
declare(strict_types=1);

/*
 * Seed the gallery with the worlds that ship inside Edusim itself.
 *
 * These ten are not student submissions -- they are the app's own prebuilt worlds,
 * exported to ordinary world files so that anyone can download one, open it through
 * Menu > Load World > Load World File, and start rearranging it. That is the whole
 * point of putting them here: a preset stops being something you visit and becomes
 * something you can take apart.
 *
 * Run it from anywhere:
 *
 *     php EdusimWorldDatabase/tools/seed-presets.php            # insert what is missing
 *     php EdusimWorldDatabase/tools/seed-presets.php --dry-run  # say what it would do
 *     php EdusimWorldDatabase/tools/seed-presets.php --force    # re-insert even if present
 *
 * It goes through the SAME lib functions a real submission does -- ewd_inspect_world_json,
 * ewd_store_world_file, ewd_insert_world -- so a seeded row is indistinguishable in shape
 * from one a student shared, and every count, checksum and tag is derived rather than
 * typed. The one exception is the screenshot: ewd_store_screenshot() requires
 * is_uploaded_file(), which is false by definition for a CLI script, so the encode step
 * is repeated here against a local file using the same ewd_resize_to_fit() and the same
 * size and quality constants.
 *
 * Idempotent by world_sha256. Re-running after regenerating one world file replaces just
 * that row; re-running after changing nothing does nothing at all.
 */

// A seeding script that answers to a URL is a seeding script somebody else can run.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../lib/config.php';
require __DIR__ . '/../lib/helpers.php';
require __DIR__ . '/../lib/db.php';
require __DIR__ . '/../lib/worldfile.php';
require __DIR__ . '/../lib/screenshot.php';

const SEED_CREATOR = 'Edusim';
const SEED_GROUP   = 'Built in';

/*
 * The world files live beside this script because nothing else generates them; the
 * screenshots do not, because docs/assets/screenshots already holds all ten at the exact
 * 1600x1000 the gallery wants and a second copy would only drift. The candidates below
 * cover both layouts this app runs in: a dev checkout (docs/ is a sibling of the app) and
 * the deployed site (docs/ IS the site root, with the app in a subdirectory under it).
 */
$SHOT_DIRS = [
    __DIR__ . '/../seed/shots',
    dirname(EWD_ROOT) . '/assets/screenshots',
    dirname(EWD_ROOT) . '/docs/assets/screenshots',
];

/*
 * Titles are the app's own labels. Descriptions say what is in the world and what to try
 * in it, because a gallery card with "The Park" and nothing else tells a student nothing
 * about whether to download it. Tags are the filter chips on the gallery, so they are
 * chosen to be worth clicking -- a tag only one world has is a dead end.
 */
$WORLDS = [
    'park' => [
        'title' => 'The Park',
        'tags'  => 'outdoors, nature, official, starter',
        'description' =>
            "The world every new visitor lands in. A great meadow with a pond and a pair of Canada geese, "
            . "a bandstand, a playground, a stone arch bridge, flower beds and the old bear dens, all laid "
            . "out the way a Victorian city park was: a main path with branches off it, and something worth "
            . "walking to at the end of each one.\n\n"
            . "Two activity boards set coding challenges here — send the geese out for a paddle, and grow the "
            . "maple from a sapling. There is also a billboard hidden behind the nature centre. Find it and it "
            . "takes you somewhere else entirely.",
    ],
    'museum' => [
        'title' => 'The Museum',
        'tags'  => 'art, indoors, official, building',
        'description' =>
            "A skylit gallery with a plaza out front. The paintings are generated in the style of six art "
            . "movements — De Stijl, Colour Field, Post-Impressionist, Ukiyo-e, Pointillist and Geometric "
            . "Abstraction — and each frame carries a plaque naming the movement, so the room teaches what it "
            . "is showing you.\n\n"
            . "The daylight is real: the roof has an actual opening in it and the sun comes through. Try "
            . "setting the mobile turning, or making the glass study change colour.",
    ],
    'library' => [
        'title' => 'The Library',
        'tags'  => 'books, indoors, official, building',
        'description' =>
            "A public reading room under a glazed lantern roof — stacks and stacks of books, Dewey Decimal "
            . "signs on the aisle ends, a card catalog nobody under thirty has ever had to use, and a globe on "
            . "its properly tilted axis.\n\n"
            . "Send the book cart back to the stacks, or give the globe a spin. And go round the back of the "
            . "hall: there is a billboard behind it that is a door to another world.",
    ],
    'moon' => [
        'title' => 'The Moon',
        'tags'  => 'space, official, science, vehicles',
        'description' =>
            "Tranquility Base, at real size. The lunar module stands about twenty feet tall, the rover is its "
            . "true ten feet long, and the flag and the footprints are where you would expect them.\n\n"
            . "The sky stays black at noon, because there is no air to scatter the light — and Earth hangs in "
            . "it, which is the detail most people get wrong. Take the buggy out for rock samples, or set the "
            . "Earth turning.",
    ],
    'mars' => [
        'title' => 'On Mars',
        'tags'  => 'space, official, science, building',
        'description' =>
            "A crewed outpost under a butterscotch sky. You walk in through a real airlock into the Habitation "
            . "Dome, where there is hydroponics growing under lights, life support, and a deck you can stand on "
            . "and look up through the glazing.\n\n"
            . "Outside there is a rover, a relay dish, a scout copter and a dust devil crossing the plain. Send "
            . "the rover out on survey, or fly the copter.",
    ],
    'dinosaur' => [
        'title' => 'Dinosaur Island',
        'tags'  => 'dinosaurs, nature, official, science',
        'description' =>
            "The last days of the Cretaceous, at full size — and every animal here really did live alongside "
            . "the others. The Tyrannosaurus is forty-one feet from nose to tail and its hip is higher than a "
            . "grown-up's head, which is the sort of thing you only believe once you are standing next to it.\n\n"
            . "There is also a Triceratops, a Quetzalcoatlus, a fossil dig with bones still in the trench, a "
            . "lagoon and a volcano smoking on the horizon. Set the Triceratops grazing, or put the "
            . "Quetzalcoatlus on patrol.",
    ],
    'voyage' => [
        'title' => 'Fantastic Voyage',
        'tags'  => 'biology, science, official, indoors',
        'description' =>
            "You have been shrunk. Walk in along an artery — a real tube you pass through, not a picture of one "
            . "— and out into a hall of organs the size of cars: lungs you can see the bronchial tree inside, a "
            . "stomach, a liver, kidneys, a heart and a brain.\n\n"
            . "Whole body systems are on labelled charts instead, because a system is a set of relationships "
            . "and a diagram carries those better than a model does. Everything is enlarged about fifteen to "
            . "twenty times, and every placard says the real size. Make the heart beat, or launch the micro-sub.",
    ],
    'empty' => [
        'title' => 'My World',
        'tags'  => 'building, starter, official, empty',
        'description' =>
            "An open green field with nothing in it but five trees and three boards — and that is the point. "
            . "Every other world is somewhere to visit; this one is somewhere to build, with an empty horizon "
            . "and no scenery to walk around while you work.\n\n"
            . "The three boards at the far side tell you what the place is for, walk you through building a "
            . "rocket out of stretchable shapes, and then walk you through programming it to fly. Start here if "
            . "you have never built anything in Edusim before.",
    ],
    'newyork' => [
        'title' => "1940's New York",
        'tags'  => 'city, history, official, vehicles',
        'description' =>
            "Broadway at Times Square in the summer of 1949, modelled from a colour photograph. Walk the street "
            . "between the taxis and the buses, look up at the BOND sign, and read the marquees — the films on "
            . "them were really playing that year.\n\n"
            . "In the app this world is hidden: it has no menu entry at all, and the only way in is to find the "
            . "billboard behind the Library and click it. Downloading it here is the other way in.",
    ],
    'sea' => [
        'title' => 'Under the Sea',
        'tags'  => 'ocean, nature, official, animals',
        'description' =>
            "A tropical coral reef thirty feet down, modelled from a photograph. A reef wall of coral gardens "
            . "on one side and open white sand on the other, with sunbeams coming down through the surface, "
            . "marine snow drifting in the water and reef sharks cruising overhead.\n\n"
            . "There is a moray eel in a cave in the reef, an octopus, and a sea star on the sand. Like New "
            . "York, this world is hidden in the app — the only way in is the billboard behind the Park's "
            . "nature centre.",
    ],

    /*
     * The curriculum worlds. Order in this table is the order they are inserted, and it is
     * deliberate: PHP preserves insertion order for string keys, and the seeder walks the
     * array in order, so the gallery's ids come out in a stable, meaningful sequence rather
     * than in whatever order a directory listing happened to return. Re-running the seeder
     * therefore never reshuffles anything.
     */
    'egypt' => [
        'title' => 'Ancient Egypt',
        'tags'  => 'history, official, science, building',
        'description' =>
            "The Giza plateau — the Great Sphinx with Khafre's pyramid rising directly behind it, which is the "
            . "view everybody knows, plus Khufu and Menkaure, the granite valley temple, a field of mastaba "
            . "tombs and Khufu's buried cedar ship.\n\n"
            . "Everything is built at one consistent fifth of true size, because the Great Pyramid's base alone "
            . "is wider than the whole walkable world. What that keeps is every proportion you can compare: "
            . "Menkaure really is less than half the height of the other two, and the Sphinx really is as long "
            . "as Menkaure's base is wide. Every sign gives the real figure.\n\n"
            . "Two coding challenges: raise the obelisk, and sail the ship of the sun.",
    ],
    'solar' => [
        'title' => 'Solar System Walk',
        'tags'  => 'space, science, official, starter',
        'description' =>
            "Walk from the Sun out past Neptune along a lit deck, with every planet, its moons, and a marker "
            . "giving the real distance from the Sun.\n\n"
            . "Size and distance are on two different scales here, and the signs say so — one scale cannot do "
            . "both, because at a scale where Jupiter is big enough to walk around, Neptune would be forty miles "
            . "away. What is faithful is the planets against EACH OTHER: standing Earth next to Jupiter is the "
            . "whole exhibit. Uranus is tipped on its side, Saturn's rings are a sheet of ice as thin as a house "
            . "is tall, and the asteroid belt is mostly empty, which is not what films show.\n\n"
            . "Two coding challenges: spin Jupiter, and send a comet in past the Sun and back out.",
    ],
    'watercycle' => [
        'title' => 'The Water Cycle',
        'tags'  => 'science, nature, official, starter',
        'description' =>
            "Evaporation, condensation, precipitation, collection and transpiration — as a loop you walk rather "
            . "than a poster you read. Five big labelled arrows mark the stages, and a stone path joins them, so "
            . "following the water all the way round brings you back where you started.\n\n"
            . "There is a sea with vapour rising off it, a field of cumulus clouds whose bases are all at exactly "
            . "the same height (that height is where the air got cold enough), one dark cloud that is actually "
            . "raining, a snow-capped mountain feeding a stream, and a cutaway showing where the rain goes once "
            . "it soaks into the ground.\n\n"
            . "Two coding challenges: send a cloud across the sky, and make the rain fall.",
    ],
    'pompeii' => [
        'title' => 'Ancient Pompeii',
        'tags'  => 'history, official, building, science',
        'description' =>
            "24 August, AD 79 — and the town is not a ruin. Every picture you have seen of Pompeii is broken "
            . "wall stumps in bright sunshine, but the point of the place is that it was an ordinary working "
            . "town on an ordinary afternoon. So the houses stand, the bar is stocked, and Vesuvius is going up "
            . "behind them.\n\n"
            . "Walk the paved street and look down: the ruts worn into the basalt by cart wheels, and the raised "
            . "stepping stones across the road with gaps exactly an axle wide, because the street doubled as the "
            . "drain. There is a forum, the oldest stone amphitheatre anywhere, painted walls, and — off to one "
            . "side, where you come upon them rather than being shown them — the plaster casts.\n\n"
            . "Two coding challenges: raise the ash column, and send a cart up the street.",
    ],
    'davinci' => [
        'title' => "Da Vinci's Studio",
        'tags'  => 'history, science, official, building',
        'description' =>
            "The workshop yard, with the machines built full size straight out of the notebooks: the "
            . "bat-framed ornithopter, the aerial screw, the spring-driven cart, the war engines, and the "
            . "drawings on their easels.\n\n"
            . "Most of these never worked, and the signs say so — the flying machines could not have lifted, and "
            . "the aerial screw would simply have spun the whole machine the other way, which is exactly why a "
            . "real helicopter needs a tail rotor. Being wrong in interesting ways for a very long time is how "
            . "engineering actually proceeds. The cart is the exception: a replica was built in 2004 and it drove.\n\n"
            . "Look at the open notebooks — the writing runs backwards, because Leonardo was left-handed.\n\n"
            . "Two coding challenges: turn the aerial screw, and drive the cart.",
    ],
    'ellis' => [
        'title' => 'Ellis Island',
        'tags'  => 'history, official, building, starter',
        'description' =>
            "New York harbour in 1907 — the busiest year the station ever had, when 1,004,756 people came "
            . "through. The Main Building with its copper domes, a steamship at the pier, Liberty across the "
            . "water, and the baggage heaped on the dock.\n\n"
            . "It is deliberately not grand. First and second class were inspected in their cabins and walked "
            . "straight off at Manhattan; only steerage came here, to a queue, a numbered tag pinned to your "
            . "coat, and a doctor who looked at your eyes for thirty seconds. Read the manifest board and the "
            . "line-inspection sign — and look at Liberty's feet, where the broken chain is.\n\n"
            . "Two coding challenges: bring the ship alongside, and light the torch.",
    ],
    'capitol' => [
        'title' => 'The U.S. Capitol',
        'tags'  => 'history, official, building, starter',
        'description' =>
            "The West Front seen from the Mall: the cast-iron dome with the Statue of Freedom on top, the two "
            . "chamber wings, the great flight of inauguration steps, a reflecting pool, and the Washington "
            . "Monument off to one side.\n\n"
            . "Three things worth finding. The dome is markedly taller than it is wide, which is what separates "
            . "it from every state house that copied it. The Washington Monument changes colour two thirds of "
            . "the way up, because building stopped for 23 years and the marble never matched. And the Statue of "
            . "Freedom wears a feathered helmet rather than a liberty cap, because Jefferson Davis objected to "
            . "the cap — she was cast by Philip Reid, who was himself enslaved.\n\n"
            . "Two coding challenges: raise the dome, and send a statue on tour.",
    ],
    'reef' => [
        'title' => 'Great Barrier Reef',
        'tags'  => 'ocean, nature, animals, science, official',
        'description' =>
            "Twenty-five feet down on the outer reef, with sunbeams coming through the surface and the whole "
            . "water column full of life: a green sea turtle, a manta ray fifteen feet across, a potato cod, "
            . "reef sharks overhead, and staghorn thickets building the reef itself.\n\n"
            . "One section is bone white, and it is not a different species. Coral is an animal that farms algae "
            . "inside itself; when the water gets too warm it expels them and turns white. It is starving at "
            . "that point, not dead — it can come back if the water cools fast enough. Much of it did not in "
            . "2016 and 2017. The healthy reef and the bleached reef are placed side by side on purpose.\n\n"
            . "Two coding challenges: fly the manta past the reef, and bleach a coral then bring it back.",
    ],
    'delta' => [
        'title' => 'Delta River Boat',
        'tags'  => 'history, nature, official, vehicles',
        'description' =>
            "A sternwheel packet at a Mississippi landing about 1870, at golden hour. The boat is the world — "
            . "130 feet of it, with open galleries of turned posts and fretwork, tall forward chimneys, and a "
            . "paddle wheel as tall as two decks.\n\n"
            . "Behind it is a cypress swamp: trees with hugely flared bases, their strange 'knees' standing up "
            . "out of the ground around them, and Spanish moss hanging off the branches — which is neither "
            . "Spanish nor a moss, but an air plant related to the pineapple.\n\n"
            . "The cotton bales on the levee are what the boat came for, and the sign does not skip what that "
            . "trade was built on. Samuel Clemens piloted boats like this one before he was a writer, and took "
            . "his pen name from the leadsman's call for twelve feet of water.\n\n"
            . "Two coding challenges: cast off downriver, and pole the pirogue across.",
    ],
    'colosseum' => [
        'title' => 'The Colosseum',
        'tags'  => 'history, official, building, starter',
        'description' =>
            "Rome, with the Flavian Amphitheatre at a third of full size — the real one is 615ft by 510ft and "
            . "would not fit inside the world. Four storeys of arcades, eighty arches round the ground floor, "
            . "and the arena floor gone so you can see the tunnels underneath.\n\n"
            . "Two thirds of the outer wall is missing, and not because of a war: earthquakes brought down the "
            . "south side and then Rome quarried the rest for a thousand years. The stone went into palaces, "
            . "bridges and St Peter's. Look for the holes all over the surviving wall — that is where iron "
            . "cramps were levered out.\n\n"
            . "The Arch of Constantine stands beside it, and most of the carving on it is older than the arch: "
            . "roundels lifted from a monument of Hadrian's, panels from Marcus Aurelius, faces recut to look "
            . "like Constantine.\n\n"
            . "Two coding challenges: march a gladiator round the arena, and make two of them work together "
            . "using say and when-an-object-says.",
    ],
    'machupicchu' => [
        'title' => 'Machu Picchu',
        'tags'  => 'history, nature, official, animals',
        'description' =>
            "The Inca citadel on its ridge at 7,970 feet, with cloud still lying in the valley and Huayna "
            . "Picchu standing behind it. Houses, temples, stairs, fountains and the farming terraces — nearly "
            . "all of it at true size, because an Inca house is a house.\n\n"
            . "The masonry is the thing to go and look at closely. Every block was cut to fit the ones already "
            . "laid, so no two are the same shape, and there is no mortar anywhere — a knife blade will not go "
            . "into the joints. The walls lean inward and every door and window is a trapezoid, wider at the "
            . "bottom. All of it is earthquake engineering, and it works: what the Spanish built in the region "
            . "afterwards has fallen down twice since.\n\n"
            . "The terraces are not just flat ground either. Each one is layered rock, gravel, sand and topsoil "
            . "carried up from the valley, draining six feet of annual rain through the mountain instead of "
            . "letting it wash the mountain away.\n\n"
            . "Two coding challenges: walk a llama up the terraces, and make the Intihuatana pulse.",
    ],
    'tajmahal' => [
        'title' => 'The Taj Mahal',
        'tags'  => 'history, official, building, art',
        'description' =>
            "Agra at first light, seen from just inside the great gate with the canal running away to the "
            . "plinth. That view is the design of the whole complex: from outside, the gate hides the building "
            . "completely, and you walk through the arch and the whole thing appears at once, framed and "
            . "reflected.\n\n"
            . "Three things worth finding. The plan is not a square — it is a square with the corners cut off, "
            . "and every one of those eight faces carries an arch. The four minarets lean about two degrees "
            . "outward on purpose, so an earthquake would drop them away from the tomb rather than onto it. And "
            . "the building on the east is not a mosque and never was: jawab means \"answer\", and it exists "
            . "only so the view has the same thing on both sides.\n\n"
            . "Shah Jahan built it for Mumtaz Mahal, who died in 1631. It took twenty-two years. He was deposed "
            . "by his own son and spent his last eight years imprisoned in the fort downriver, where he could "
            . "see it.\n\n"
            . "Two coding challenges: straighten a minaret, and send a cypress down the canal.",
    ],
    'redsquare' => [
        'title' => 'Red Square',
        'tags'  => 'history, official, building, winter',
        'description' =>
            "Moscow under snow: St Basil's at the south end, the Kremlin wall and Lenin's tomb down one side, "
            . "GUM down the other, and the State History Museum closing the north.\n\n"
            . "St Basil's is nine churches on one foundation — eight chapels arranged as an eight-pointed star "
            . "around a ninth — and no two of its domes are alike. Spirals, chevrons, facets, in green, red, "
            . "blue and gold. None of that colour is original: the cathedral stood white with gold domes for a "
            . "hundred years, and nobody is certain why it was painted.\n\n"
            . "The Kremlin wall's battlements are swallowtails, a two-pronged M, and that is an import — the "
            . "Milanese architects who built it in the 1490s brought the shape from northern Italy. The ruby "
            . "star on the Spasskaya Tower went up in 1937 where a double-headed imperial eagle had been; it is "
            . "real glass, lit from inside, and it turns in the wind.\n\n"
            . "Two coding challenges: raise the cathedral out of the snow, and run a parade past the tomb.",
    ],
    'bugs' => [
        'title' => "A Bug's Life",
        'tags'  => 'nature, animals, science, official, starter, building',
        'description' =>
            "An ant colony, and you are the size of an ant. A blade of grass is a fifty-foot tower, a pebble "
            . "is a boulder and a breadcrumb is something you would need help to carry.\n\n"
            . "This one is a workshop rather than a place to look at. An avenue runs from where you arrive "
            . "down to the nest, with FIVE BUILDING challenges along the left and FIVE CODING challenges "
            . "along the right — bridge the water drop, build a worker ant, raise a grain store, lean a "
            . "ladder up to a fallen leaf, and invent a bug of your own; then send an ant down the scent "
            . "trail, run a forager's round trip, make one ant signal another, carry a crumb home, and get "
            . "the ladybird off the leaf. The whole middle of the avenue is left empty on purpose, because "
            . "that is where your own pieces land.\n\n"
            . "Cut into the soil beside the mound is a section through the nest: the nursery near the top "
            . "where the sun warms it, the seed store in the middle, the queen deep down, and the rubbish "
            . "heap kept well away from the food. There is no leader anywhere in it. An ant that finds food "
            . "walks home laying a scent trail; a shorter route gets walked more often, so it gets stronger "
            . "faster, and the colony ends up on the best path without a single ant ever comparing two "
            . "routes.\n\n"
            . "Out on the clover there is a herd of aphids being farmed for honeydew — real agriculture, "
            . "fifty million years older than ours.",
    ],
];

// ---------------------------------------------------------------------------

$argvFlags = array_slice($argv, 1);
$dryRun = in_array('--dry-run', $argvFlags, true);
$force  = in_array('--force', $argvFlags, true);

/*
 * --only=key,key restricts the run to named worlds.
 *
 * This exists because deduplication is on `world_sha256` and there is NO update path --
 * every route through this script ends in an insert. So any edit that changes a world
 * file's bytes makes it look brand new, and a full re-run quietly adds a second copy of a
 * world that is already published. That is not hypothetical: repointing the in-world
 * browser panels rewrote one URL inside nine already-seeded worlds, and the very next
 * dry run offered to insert all nine again.
 *
 * The safe habit is therefore to name what you are adding rather than to run the whole
 * table and trust the hash to sort it out. `--force` is the opposite of a fix here: it
 * skips the hash check, so it inserts the duplicate rather than preventing it.
 */
$only = null;
foreach ($argvFlags as $flag) {
    if (str_starts_with($flag, '--only=')) {
        $only = array_values(array_filter(array_map('trim', explode(',', substr($flag, 7)))));
    }
}
if ($only !== null) {
    $unknown = array_diff($only, array_keys($WORLDS));
    if ($unknown) {
        fwrite(STDERR, 'Unknown world key(s): ' . implode(', ', $unknown) . PHP_EOL);
        exit(1);
    }
}

function say(string $msg): void
{
    fwrite(STDOUT, $msg . PHP_EOL);
}

/**
 * The tail of ewd_store_screenshot(), against a path on disk instead of an upload.
 * Same constants, same encoder, same naming, so a seeded screenshot is byte-for-byte the
 * kind of file the share form produces.
 *
 * @return array{path: string, thumb: string, width: int, height: int}
 */
function seed_store_shot(string $file, string $slug): array
{
    $src = @imagecreatefromstring((string)file_get_contents($file));
    if ($src === false) {
        throw new RuntimeException("Could not read screenshot: $file");
    }
    try {
        ewd_ensure_dirs();
        $stem  = $slug . '-' . bin2hex(random_bytes(6));
        $name  = $stem . '.jpg';
        $thumb = $stem . '-thumb.jpg';

        $main = ewd_resize_to_fit($src, EWD_SHOT_MAX_W, EWD_SHOT_MAX_H);
        if (!imagejpeg($main, EWD_SHOT_DIR . '/' . $name, EWD_JPEG_QUALITY)) {
            imagedestroy($main);
            throw new RuntimeException('Could not write ' . EWD_SHOT_DIR . '/' . $name);
        }
        $out = ['path' => $name, 'thumb' => $thumb, 'width' => imagesx($main), 'height' => imagesy($main)];

        $thumbImg = ewd_resize_to_fit($main, EWD_THUMB_MAX_W, EWD_THUMB_MAX_H);
        if (!imagejpeg($thumbImg, EWD_SHOT_DIR . '/' . $thumb, EWD_JPEG_QUALITY)) {
            $out['thumb'] = '';
        }
        imagedestroy($thumbImg);
        imagedestroy($main);

        @chmod(EWD_SHOT_DIR . '/' . $name, 0644);
        if ($out['thumb'] !== '') {
            @chmod(EWD_SHOT_DIR . '/' . $out['thumb'], 0644);
        }
        return $out;
    } finally {
        imagedestroy($src);
    }
}

function find_shot(array $dirs, string $key): ?string
{
    foreach ($dirs as $dir) {
        $p = $dir . '/world_' . $key . '.jpg';
        if (is_file($p)) {
            return $p;
        }
    }
    return null;
}

$seedDir = __DIR__ . '/../seed/worlds';
$inserted = $skipped = $replaced = $failed = 0;

foreach ($WORLDS as $key => $meta) {
    if ($only !== null && !in_array($key, $only, true)) {
        continue;
    }
    $jsonPath = $seedDir . '/' . $key . '.json';
    if (!is_file($jsonPath)) {
        say("SKIP  $key — no world file at $jsonPath");
        $failed++;
        continue;
    }
    $shotPath = find_shot($SHOT_DIRS, $key);
    if ($shotPath === null) {
        say("SKIP  $key — no screenshot world_$key.jpg in any of: " . implode(', ', $SHOT_DIRS));
        $failed++;
        continue;
    }

    $raw = (string)file_get_contents($jsonPath);
    $info = ewd_inspect_world_json($raw);
    if (!$info['ok']) {
        say("FAIL  $key — {$info['error']}");
        $failed++;
        continue;
    }

    $sha = hash('sha256', $raw);
    $existing = ewd_find_world_by_hash($sha);
    if ($existing && !$force) {
        say(sprintf('SAME  %-9s already in the gallery as #%d (%s)', $key, $existing['id'], $existing['slug']));
        $skipped++;
        continue;
    }

    if ($dryRun) {
        say(sprintf(
            'WOULD %-9s %-18s %3d records, %-9s %s',
            $key, $meta['title'], $info['records'], $info['theme'], basename($shotPath)
        ));
        continue;
    }

    // --force means "this world file changed": drop the old row (and its files) so the
    // gallery does not end up showing the same world twice.
    if ($existing) {
        ewd_delete_world((int)$existing['id']);
        $replaced++;
    }

    $slug  = ewd_unique_slug(ewd_slugify($meta['title']));
    $world = ewd_store_world_file($raw, $slug);
    $shot  = seed_store_shot($shotPath, $slug);
    $now   = ewd_now();

    $id = ewd_insert_world([
        'slug'         => $slug,
        'title'        => $meta['title'],
        'creator'      => SEED_CREATOR,
        'group_name'   => SEED_GROUP,
        'description'  => $meta['description'],
        'theme'        => $info['theme'],
        'record_count' => $info['records'],
        'kinds_json'   => json_encode($info['kinds'], JSON_THROW_ON_ERROR),
        'world_path'   => $world['path'],
        'world_bytes'  => $world['bytes'],
        'world_sha256' => $world['sha256'],
        'shot_path'    => $shot['path'],
        'shot_thumb_path' => $shot['thumb'],
        'shot_width'   => $shot['width'],
        'shot_height'  => $shot['height'],
        // Published outright, whatever EWD_REQUIRE_APPROVAL says. These are the app's own
        // worlds; there is nobody for them to be waiting on.
        'status'       => 'published',
        // No management key: nothing here should be deletable by whoever holds a link.
        // password_hash of random bytes is a key that provably does not exist.
        'manage_key_hash'   => password_hash(bin2hex(random_bytes(32)), PASSWORD_DEFAULT),
        'submitter_ip_hash' => '',
        'created_at'   => $now,
        'updated_at'   => $now,
    ], ewd_parse_tags($meta['tags']));

    say(sprintf(
        'OK    %-9s #%-3d %-18s %3d records, %-9s %s',
        $key, $id, $slug, $info['records'], $info['theme'], ewd_bytes($world['bytes'])
    ));
    $inserted++;
}

say('');
say(sprintf(
    '%s: %d inserted, %d replaced, %d already present, %d failed.',
    $dryRun ? 'Dry run' : 'Done', $inserted, $replaced, $skipped, $failed
));
exit($failed > 0 ? 1 : 0);
