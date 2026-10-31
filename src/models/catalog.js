// The Model Database's one table. It imports nothing and builds nothing, so the panel, the
// check tool (tools/check-models.mjs), the picture tool (tools/build-model-pictures.mjs), the
// stats vocabulary and the teacher page (tools/build-models-page.mjs) can all read it and
// cannot disagree.
//
// AN `id` IS PERSISTED, so this table is add-only. A placed model's record is
// { kind: 'catalog-model', model: id, transform } and nothing else, which is why one costs a
// world file about two hundred bytes. Renaming an id, or removing one, turns that model in
// somebody's saved world into a console line. A title can change freely; an id cannot.
//
// Every entry has either:
//   prop     -- a PROP_BUILDERS key already in the main bundle, with optional `options`
//   builder  -- which lazy chunk in src/models/builders/ holds its builder, keyed by this id
//
// Being in a world does not make a prop good enough for this table. Fantastic Voyage's heart and
// lungs measure well and are partly inside out, and its brain and the Egypt world's Sphinx do not
// hold up at the range a student walks up to, so those four are built afresh in builders/.
//
// `scale` is what a fresh placement and Reset Shape use. Models are authored at whatever size
// their world wanted (the Colosseum is 193ft across, a monarch 3.9ft), so this is what makes
// them all arrive at a size a student can walk round. `realSize` and `shownAt` say what that
// means, because an enlargement or a reduction that is stated teaches and one that is not
// misleads. `yaw` turns the model from the student's sightline, for the things authored
// along X whose best view is not head-on; `hover` is feet above the ground for what would
// otherwise lie on it. `answer` is printed on the teacher page and never shown in the app.
//
// FACTS GO HERE AND NOWHERE ELSE. Only figures a reference would back belong in `facts` or
// `realSize`: a card a teacher reads aloud is the last place to invent a number. The rule the
// research library keeps applies here too: when a model simplifies, its card says so.

export const MODEL_CATEGORIES = [
  { key: 'body', label: 'Human Body', icon: '🫀', accent: '#e4577a' },
  { key: 'life', label: 'Plants & Animals', icon: '🦖', accent: '#5fae57' },
  { key: 'space', label: 'Earth & Space', icon: '🪐', accent: '#5c8dea' },
  { key: 'lab', label: 'Chemistry & Physics', icon: '⚛️', accent: '#9c6ade' },
  { key: 'machines', label: 'Inventions & Transport', icon: '⚙️', accent: '#e39a33' },
  { key: 'landmarks', label: 'Landmarks', icon: '🏛️', accent: '#c9a24d' },
  { key: 'artifacts', label: 'History & Artifacts', icon: '🏺', accent: '#b9734a' },
  { key: 'arts', label: 'Arts & Music', icon: '🎻', accent: '#d35fb7' },
];

export const GRADE_BANDS = ['K-2', '3-5', '6-8', '9-12'];

const ALL = GRADE_BANDS;
const UP3 = ['3-5', '6-8', '9-12'];
const UP6 = ['6-8', '9-12'];

export const MODELS = [
  // --- Human Body ---------------------------------------------------------------------
  {
    id: 'human-heart', title: 'Human Heart', category: 'body', builder: 'life', scale: 1,
    grades: UP3, subjects: ['biology', 'human body', 'health'],
    aliases: ['cardiac', 'circulation', 'circulatory system', 'ventricle', 'atrium', 'aorta', 'blood', 'valve', 'organ'],
    blurb: 'The pump at the middle of the circulatory system, with its great vessels in place.',
    facts: [
      'It has four chambers: two atria that receive blood and two ventricles that push it out.',
      'A resting adult heart beats about 100,000 times a day.',
      'Red in this model means blood carrying oxygen; blue means blood returning to collect more.',
    ],
    realSize: 'About the size of a closed fist, roughly 5 inches long', shownAt: 'Greatly enlarged',
    tryThis: 'Give it a program that changes its size up and down to make it beat.',
  },
  {
    id: 'human-brain', title: 'Human Brain', category: 'body', builder: 'life', scale: 1, pictureElevation: 22,
    grades: UP3, subjects: ['biology', 'human body', 'psychology'],
    aliases: ['cerebrum', 'cerebellum', 'brainstem', 'nervous system', 'cortex', 'gyri', 'sulci', 'organ', 'mind'],
    blurb: 'The cerebrum, cerebellum and brainstem, with the folds that pack a large surface into a small skull.',
    facts: [
      'An adult brain weighs about 3 pounds.',
      'It contains roughly 86 billion neurons.',
      'The folds let far more cortex fit inside the skull than a smooth surface could.',
    ],
    realSize: 'About 6 inches long', shownAt: 'Greatly enlarged',
    tryThis: 'Walk round it and find the cerebellum at the back, under the two big halves.',
  },
  {
    id: 'human-lungs', title: 'Human Lungs', category: 'body', builder: 'life', scale: 1, yaw: 0.3,
    grades: UP3, subjects: ['biology', 'human body', 'health'],
    aliases: ['respiratory system', 'breathing', 'trachea', 'bronchi', 'bronchial tree', 'windpipe', 'diaphragm', 'organ', 'oxygen'],
    blurb: 'A pair of lungs with the windpipe above, one side opened to show the branching airways inside.',
    facts: [
      'The right lung has three lobes and the left has two, which leaves room for the heart.',
      'Airways branch again and again, ending in hundreds of millions of tiny air sacs called alveoli.',
      'Oxygen crosses into the blood through the thin walls of the alveoli.',
    ],
    realSize: 'Each lung is about 10 inches tall', shownAt: 'Greatly enlarged',
    tryThis: 'Count the lobes on each side. Why would the two lungs be different?',
  },
  {
    id: 'animal-cell', title: 'Animal Cell', category: 'body', prop: 'cell-model', scale: 0.6,
    grades: UP3, subjects: ['biology', 'cells'],
    aliases: ['nucleus', 'mitochondria', 'mitochondrion', 'organelle', 'membrane', 'ribosome', 'golgi', 'endoplasmic reticulum', 'cytoplasm', 'microscopic'],
    blurb: 'A cell with a wedge cut away so you can look in at the nucleus and the organelles around it.',
    facts: [
      'A typical animal cell is too small to see without a microscope.',
      'The nucleus holds the cell’s DNA.',
      'Mitochondria release the energy the rest of the cell runs on.',
    ],
    realSize: 'Around 10 to 30 micrometres across', shownAt: 'Enlarged thousands of times',
    tryThis: 'Build a label for each organelle you can name using Create Model and an info sign.',
  },
  {
    id: 'dna-helix', title: 'DNA Double Helix', category: 'body', prop: 'dna-helix', scale: 0.4,
    grades: UP6, subjects: ['biology', 'genetics', 'chemistry'],
    aliases: ['genetics', 'gene', 'genome', 'base pair', 'adenine', 'thymine', 'guanine', 'cytosine', 'chromosome', 'heredity', 'watson', 'crick', 'franklin'],
    blurb: 'Two sugar-phosphate backbones twisted round each other, joined by pairs of bases.',
    facts: [
      'Adenine pairs with thymine, and cytosine pairs with guanine.',
      'The molecule is only about 2 nanometres wide.',
      'The DNA in one human cell would stretch about 6 feet if it were laid out straight.',
    ],
    realSize: 'About 2 nanometres wide', shownAt: 'Enlarged tens of millions of times',
    tryThis: 'Program it to rotate slowly so you can follow one strand all the way up.',
    program: 'spinSlow',
  },
  {
    id: 'human-skeleton', title: 'Human Skeleton', category: 'body', builder: 'life', scale: 1,
    grades: UP3, subjects: ['biology', 'human body', 'anatomy'],
    aliases: ['bones', 'skull', 'ribs', 'rib cage', 'spine', 'vertebrae', 'femur', 'pelvis', 'skeletal system', 'anatomy'],
    blurb: 'A standing adult skeleton on a display stand, built as a teaching model.',
    facts: [
      'An adult skeleton has 206 bones. A baby starts with more, and some of them fuse as it grows.',
      'The femur, in the thigh, is the longest bone in the body.',
      'The smallest bone is the stapes, deep inside the ear.',
    ],
    realSize: 'About 5 to 6 feet tall', shownAt: 'About life size',
    tryThis: 'Stand beside it. Which of its bones can you feel in your own body?',
  },

  // --- Plants & Animals ---------------------------------------------------------------
  {
    id: 'tyrannosaurus-rex', title: 'Tyrannosaurus rex', category: 'life', prop: 'tyrannosaurus', scale: 0.5, yaw: 0.45,
    grades: ALL, subjects: ['paleontology', 'biology', 'earth history'],
    aliases: ['t rex', 't-rex', 'trex', 'dinosaur', 'theropod', 'cretaceous', 'predator', 'carnivore', 'fossil'],
    blurb: 'The great Late Cretaceous predator, with its short arms and enormous jaws.',
    facts: [
      'It lived about 68 to 66 million years ago, in what is now western North America.',
      'It grew to about 40 feet long and stood about 13 feet tall at the hip.',
      'Its teeth could be as long as a banana.',
    ],
    realSize: 'About 40 feet long', shownAt: 'Half life size',
    tryThis: 'Open Bring it to life and make it turn to watch you as you walk past.',
  },
  {
    id: 'triceratops', title: 'Triceratops', category: 'life', prop: 'triceratops', scale: 0.6, yaw: 0.45,
    grades: ALL, subjects: ['paleontology', 'biology', 'earth history'],
    aliases: ['dinosaur', 'three horns', 'frill', 'ceratopsian', 'cretaceous', 'herbivore', 'fossil'],
    blurb: 'A plant-eating dinosaur with three horns and a broad bony frill.',
    facts: [
      'It lived at the same time and in the same places as Tyrannosaurus rex.',
      'Its two brow horns could reach about 3 feet long.',
      'It was a herbivore, slicing plants with a beak and rows of shearing teeth.',
    ],
    realSize: 'About 30 feet long', shownAt: 'About 60% of life size',
    tryThis: 'Place a T. rex beside it, then use the size notes on both cards to set them to scale.',
  },
  {
    id: 'octopus', title: 'Octopus', category: 'life', prop: 'octopus', scale: 1.4,
    grades: ALL, subjects: ['biology', 'marine science'],
    aliases: ['cephalopod', 'mollusc', 'mollusk', 'tentacles', 'suckers', 'ocean', 'sea', 'invertebrate'],
    blurb: 'A soft-bodied ocean animal with eight arms and a strikingly intelligent eye.',
    facts: [
      'An octopus has three hearts and blue blood.',
      'Most of its neurons are in its arms rather than in its brain.',
      'With no bones, it can squeeze through a gap barely bigger than its eye.',
    ],
    realSize: 'A common octopus spans about 3 feet', shownAt: 'About twice life size',
    tryThis: 'Look for the shape of its pupil. How is it different from yours?',
  },
  {
    id: 'reef-shark', title: 'Reef Shark', category: 'life', prop: 'reef-shark', scale: 1, hover: 3.5, yaw: 1.15,
    grades: ALL, subjects: ['biology', 'marine science'],
    aliases: ['fish', 'ocean', 'sea', 'predator', 'cartilage', 'coral reef', 'gills', 'fin'],
    blurb: 'A grey reef shark, darker above and white below, the colouring that hides it from both directions.',
    facts: [
      'A shark’s skeleton is cartilage rather than bone.',
      'It grows new teeth throughout its life, in rows that move forward to replace lost ones.',
      'Being dark above and pale below is called countershading.',
    ],
    realSize: 'About 6 feet long', shownAt: 'A little over life size',
    tryThis: 'Its starter program swims it in a circle. Change the numbers to make the circle wider.',
    program: 'swimCircle',
  },
  {
    id: 'monarch-butterfly', title: 'Monarch Butterfly', category: 'life', prop: 'butterfly', options: { species: 'monarch', pose: 'perch' }, scale: 1.4,
    grades: ALL, subjects: ['biology', 'life cycles', 'ecology'],
    aliases: ['insect', 'pollinator', 'caterpillar', 'chrysalis', 'metamorphosis', 'milkweed', 'migration'],
    blurb: 'North America’s best-known butterfly, with its orange wings and black veins.',
    facts: [
      'Monarchs from eastern North America can fly up to 3,000 miles to spend the winter in Mexico.',
      'Their caterpillars eat only milkweed, which makes them taste bad to birds.',
      'The butterfly that returns north is often the great-grandchild of the one that left.',
    ],
    realSize: 'A wingspan of about 4 inches', shownAt: 'About 16 times life size',
    tryThis: 'Open Bring it to life and find a motion that looks like a butterfly.',
  },
  {
    id: 'sunflower', title: 'Sunflower', category: 'life', prop: 'sunflower', scale: 0.2,
    grades: ALL, subjects: ['biology', 'plants', 'mathematics'],
    aliases: ['plant', 'flower', 'seed', 'kansas', 'fibonacci', 'spiral', 'phototropism', 'heliotropism', 'botany', 'pollinator'],
    blurb: 'A tall garden sunflower, with the spiral seed head that mathematicians love.',
    facts: [
      'It is the state flower of Kansas.',
      'Young sunflowers turn to follow the sun across the sky. Mature heads settle facing east.',
      'The seeds grow in interlocking spirals, and their counts are usually Fibonacci numbers.',
    ],
    realSize: 'Around 8 feet tall', shownAt: 'About one and a half times life size',
    tryThis: 'Plant a row of them and stretch each to a different height, like a bar chart.',
  },
  {
    id: 'honey-bee', title: 'Honey Bee', category: 'life', builder: 'life', scale: 1, hover: 3, pictureElevation: 20,
    grades: ALL, subjects: ['biology', 'ecology', 'pollination'],
    aliases: ['insect', 'pollinator', 'hive', 'honey', 'worker bee', 'waggle dance', 'pollen'],
    blurb: 'A worker honey bee, with pollen baskets on its back legs.',
    facts: [
      'A worker bee makes about a twelfth of a teaspoon of honey in her whole life.',
      'Bees tell each other where food is by dancing.',
      'A bee has five eyes: two large compound eyes and three small simple ones.',
    ],
    realSize: 'About half an inch long', shownAt: 'Greatly enlarged',
    tryThis: 'Program a waggle dance: a straight run, a turn, and back to the start.',
    program: 'buzzCircle',
  },
  {
    id: 'leopard-frog', title: 'Leopard Frog', category: 'life', builder: 'life', scale: 1, pictureElevation: 24,
    grades: ALL, subjects: ['biology', 'life cycles', 'ecology'],
    aliases: ['amphibian', 'tadpole', 'metamorphosis', 'pond', 'wetland', 'toad', 'vertebrate'],
    blurb: 'A northern leopard frog, spotted and crouched ready to jump.',
    facts: [
      'A frog starts life as a tadpole with gills and a tail, and changes into an adult.',
      'It can breathe through its skin as well as with its lungs.',
      'It pushes food down its throat partly by pulling its eyes into its head.',
    ],
    realSize: 'About 2 to 4 inches long', shownAt: 'Greatly enlarged',
    tryThis: 'Its starter program makes it hop. How far can you make it jump?',
    program: 'hop',
  },

  // --- Earth & Space ------------------------------------------------------------------
  {
    id: 'cutaway-volcano', title: 'Cutaway Volcano', category: 'space', prop: 'cutaway-volcano', scale: 0.14, yaw: 0.55,
    grades: ALL, subjects: ['earth science', 'geology'],
    aliases: ['stratovolcano', 'magma', 'lava', 'eruption', 'crater', 'magma chamber', 'vent', 'rock cycle'],
    blurb: 'A cone-shaped volcano with a quarter removed so you can see the plumbing inside.',
    facts: [
      'Molten rock is called magma underground and lava once it reaches the surface.',
      'A stratovolcano is built from layers of lava and ash from many eruptions.',
      'Mount St. Helens, in Washington, is a stratovolcano.',
    ],
    realSize: 'A real stratovolcano can be well over a mile high', shownAt: 'A tiny scale model',
    tryThis: 'Find the magma chamber, then trace the path magma takes to the crater.',
  },
  {
    id: 'earth-layers', title: 'Earth’s Layers', category: 'space', builder: 'space', scale: 1,
    grades: UP3, subjects: ['earth science', 'geology'],
    aliases: ['crust', 'mantle', 'outer core', 'inner core', 'planet', 'globe', 'cutaway', 'plate tectonics', 'interior'],
    blurb: 'The Earth with a wedge removed, showing the crust, mantle, outer core and inner core.',
    facts: [
      'The crust is the thinnest layer, from about 3 to 45 miles thick.',
      'The outer core is liquid metal, and its motion produces Earth’s magnetic field.',
      'The inner core is solid because of the enormous pressure on it, even though it is extremely hot.',
    ],
    realSize: 'About 7,900 miles across', shownAt: 'A tiny scale model',
    tryThis: 'Stretch it into a wide oval. Real Earth is very slightly wider at the equator too.',
    program: 'spinSlow',
  },
  {
    id: 'solar-system-orrery', title: 'Solar System Orrery', category: 'space', builder: 'space', scale: 1,
    grades: ALL, subjects: ['astronomy', 'history of science'],
    aliases: ['planets', 'sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'orbit', 'clockwork', 'heliocentric'],
    blurb: 'A clockwork model of the Sun and all eight planets, each on its own arm.',
    facts: [
      'Orreries are named after an Earl of Orrery, who owned one in the early 1700s.',
      'Sizes and distances here are not to scale. To scale, the outer planets would be far out of sight.',
      'In a real orrery, gears turn the inner planets faster than the outer ones, as in the real Solar System. This model turns as one piece.',
    ],
    realSize: 'A desktop orrery is usually a couple of feet across', shownAt: 'Room-sized',
    tryThis: 'Press the green arrow to turn it. Which planets would go faster in the real Solar System?',
    program: 'spin',
  },
  {
    id: 'lunar-module', title: 'Apollo Lunar Module', category: 'space', builder: 'space', scale: 1, pictureElevation: 12,
    grades: ALL, subjects: ['space exploration', 'engineering', 'history'],
    aliases: ['apollo', 'lem', 'lm', 'eagle', 'moon landing', 'nasa', 'astronaut', 'armstrong', 'aldrin', 'spacecraft'],
    blurb: 'The spacecraft that landed astronauts on the Moon, with its gold foil and four legs.',
    facts: [
      'Apollo landed twelve astronauts on the Moon on six missions between 1969 and 1972.',
      'It had two stages. The lower one stayed on the Moon and served as the launch pad for the upper one.',
      'It flew only in space, so it needed no streamlining at all.',
    ],
    realSize: 'About 23 feet tall', shownAt: 'Life size',
    tryThis: 'Its starter program lifts off. Add a second object to play the stage left behind.',
    program: 'liftOff',
  },
  {
    id: 'mars-rover', title: 'Mars Rover', category: 'space', builder: 'space', scale: 1, yaw: 0.5,
    grades: ALL, subjects: ['space exploration', 'engineering', 'robotics'],
    aliases: ['perseverance', 'curiosity', 'nasa', 'robot', 'planet', 'red planet', 'rocker bogie', 'spacecraft'],
    blurb: 'A six-wheeled science rover with a camera mast and a long robotic arm.',
    facts: [
      'NASA’s Perseverance rover landed in Jezero Crater on Mars in February 2021.',
      'It is about 10 feet long and weighs about a ton.',
      'A radio signal takes between about 3 and 22 minutes to reach Mars, so rovers are not driven live.',
    ],
    realSize: 'About 10 feet long', shownAt: 'Life size',
    tryThis: 'Program a route. Remember, you could not steer it in real time on Mars.',
    program: 'driveSquare',
  },
  {
    id: 'saturn-v', title: 'Saturn V Rocket', category: 'space', builder: 'space', scale: 0.07, pictureElevation: 8,
    grades: ALL, subjects: ['space exploration', 'engineering', 'history'],
    aliases: ['apollo', 'moon rocket', 'nasa', 'launch', 'stages', 'von braun', 'spacecraft'],
    blurb: 'The three-stage rocket that sent Apollo astronauts to the Moon.',
    facts: [
      'It stood about 363 feet tall, taller than the Statue of Liberty with its pedestal.',
      'It was launched 13 times between 1967 and 1973.',
      'Each stage dropped away when its fuel ran out, so the rest had less weight to lift.',
    ],
    realSize: 'About 363 feet tall', shownAt: 'About 1/14 of life size',
    tryThis: 'Its starter program lifts off. Can you make it speed up as it climbs?',
    program: 'liftOff',
  },
  {
    id: 'amethyst-geode', title: 'Amethyst Geode', category: 'space', builder: 'space', scale: 1, pictureElevation: 22,
    grades: ALL, subjects: ['earth science', 'geology', 'mineralogy'],
    aliases: ['crystal', 'quartz', 'mineral', 'gem', 'rock', 'purple', 'cave', 'mohs'],
    blurb: 'A rock cracked open to show a hollow lined with purple quartz crystals.',
    facts: [
      'Amethyst is a purple variety of quartz, coloured by traces of iron and natural radiation.',
      'Many geodes begin as gas bubbles trapped in cooling lava.',
      'Crystals grow slowly inward as mineral-rich water seeps through the hollow.',
    ],
    realSize: 'From fist-sized to taller than a person', shownAt: 'A large specimen',
    tryThis: 'Stretch it wider and walk up close. How do the crystals change from the rim inward?',
  },

  // --- Chemistry & Physics ------------------------------------------------------------
  {
    id: 'carbon-atom', title: 'Carbon Atom (Bohr Model)', category: 'lab', builder: 'lab', scale: 1,
    grades: UP3, subjects: ['chemistry', 'physics'],
    aliases: ['atom', 'proton', 'neutron', 'electron', 'nucleus', 'bohr', 'orbit', 'shell', 'element', 'periodic table'],
    blurb: 'Six protons and six neutrons in the nucleus, with six electrons in two shells.',
    facts: [
      'Niels Bohr proposed this kind of model in 1913.',
      'It is a simplification: electrons actually occupy fuzzy regions called orbitals, not neat rings.',
      'An atom is almost entirely empty space, and to scale the nucleus would be far too small to see here.',
    ],
    realSize: 'About 0.3 billionths of a metre across', shownAt: 'Enlarged tens of billions of times',
    tryThis: 'Press the green arrow to spin it. Count two electrons in the inner shell and four in the outer.',
    program: 'spin',
  },
  {
    id: 'water-molecule', title: 'Water Molecule', category: 'lab', prop: 'ah-molecule', options: { kind: 'water' }, scale: 0.7,
    grades: UP3, subjects: ['chemistry', 'biology'],
    aliases: ['h2o', 'oxygen', 'hydrogen', 'bond', 'covalent', 'polar', 'molecule', 'lone pair'],
    blurb: 'One oxygen atom and two hydrogen atoms, in the bent shape that makes water so unusual.',
    facts: [
      'The two hydrogen atoms sit about 104.5 degrees apart.',
      'That bend makes one side of the molecule slightly positive and the other slightly negative.',
      'This polarity is why water dissolves so many substances.',
    ],
    realSize: 'About 0.3 billionths of a metre across', shownAt: 'Enlarged tens of billions of times',
    tryThis: 'Place several and arrange the hydrogens of one toward the oxygen of the next.',
  },
  {
    id: 'salt-crystal', title: 'Salt Crystal Lattice', category: 'lab', builder: 'lab', scale: 1, pictureElevation: 24,
    grades: UP6, subjects: ['chemistry'],
    aliases: ['sodium chloride', 'nacl', 'ion', 'ionic bond', 'lattice', 'crystal', 'halite', 'table salt'],
    blurb: 'Sodium and chloride ions in the repeating cubic pattern that makes every salt grain a tiny cube.',
    facts: [
      'Each sodium ion is surrounded by six chloride ions, and each chloride by six sodium ions.',
      'Chloride ions are noticeably bigger than sodium ions.',
      'The cubic arrangement is why salt grains look like tiny cubes under a magnifier.',
      'The rods only show the pattern. In real salt the ions touch, and nothing like a stick joins them.',
    ],
    realSize: 'Ions are about 0.28 billionths of a metre apart', shownAt: 'Enlarged tens of billions of times',
    tryThis: 'Find an ion in the middle of the block and count its six nearest neighbours.',
    program: 'spinSlow',
  },
  {
    id: 'newtons-cradle', title: 'Newton’s Cradle', category: 'lab', builder: 'lab', scale: 1,
    grades: UP3, subjects: ['physics'],
    aliases: ['momentum', 'energy', 'pendulum', 'collision', 'newton', 'swinging balls', 'conservation'],
    blurb: 'A row of steel balls hanging on threads, the classic demonstration of momentum.',
    facts: [
      'Swing one ball in and one ball swings out the other side. Swing two and two come out.',
      'It demonstrates conservation of momentum and of energy.',
      'It is named after Isaac Newton, who described the laws of motion, and he did not invent it.',
    ],
    realSize: 'A desk toy about 7 inches long', shownAt: 'Enlarged about 9 times',
    tryThis: 'Why do the balls eventually stop? Think about where the energy goes.',
  },
  {
    id: 'compound-microscope', title: 'Compound Microscope', category: 'lab', builder: 'lab', scale: 1,
    grades: ALL, subjects: ['biology', 'physics', 'history of science'],
    aliases: ['lens', 'objective', 'eyepiece', 'slide', 'magnify', 'hooke', 'leeuwenhoek', 'laboratory', 'optics'],
    blurb: 'A classroom microscope with an eyepiece, three objective lenses, a stage and focus knobs.',
    facts: [
      'Total magnification is the eyepiece power multiplied by the objective power.',
      'Robert Hooke used one to look at cork and coined the word "cell" in 1665.',
      'The focus knobs raise and lower the stage to bring a slide into focus.',
    ],
    realSize: 'About a foot tall', shownAt: 'Enlarged about 7 times',
    tryThis: 'A 10x eyepiece with a 40x objective magnifies how many times?',
  },
  {
    id: 'gear-train', title: 'Gear Train', category: 'lab', builder: 'lab', scale: 1,
    grades: ALL, subjects: ['physics', 'engineering'],
    aliases: ['gears', 'cog', 'teeth', 'simple machine', 'torque', 'ratio', 'mechanism', 'clockwork'],
    blurb: 'Three meshed gears of different sizes on a stand, showing how gears trade speed for force.',
    facts: [
      'Two meshed gears always turn in opposite directions.',
      'A small gear driving a big one turns it more slowly but with more force.',
      'The speed ratio is set by the ratio of the numbers of teeth.',
    ],
    realSize: 'Gears range from wristwatch parts to ship engines', shownAt: 'A large demonstration model',
    tryThis: 'Count the teeth on two gears. How many turns of the small one make one of the big one?',
  },

  // --- Inventions & Transport ---------------------------------------------------------
  {
    id: 'classroom-robot', title: 'Classroom Robot', category: 'machines', prop: 'robot', scale: 1,
    grades: ALL, subjects: ['robotics', 'computer science', 'engineering'],
    aliases: ['droid', 'programming', 'coding', 'bot', 'sensor', 'automation', 'machine'],
    blurb: 'A friendly three-wheeled robot with stereo sensors, ready to be programmed.',
    facts: [
      'The word "robot" comes from a 1920 Czech play by Karel Čapek.',
      'Two sensors side by side can judge distance, the same way two eyes do.',
      'This robot is an invention of Edusim rather than a copy of any real product.',
    ],
    realSize: 'Imagined as a robot about as tall as a student', shownAt: 'Its own size',
    tryThis: 'Its starter program drives a square. What would you change to make a triangle?',
    program: 'driveSquare',
  },
  {
    id: 'da-vinci-ornithopter', title: 'da Vinci’s Ornithopter', category: 'machines', prop: 'ornithopter', scale: 0.5,
    grades: ALL, subjects: ['history', 'engineering', 'art'],
    aliases: ['leonardo', 'flying machine', 'renaissance', 'wings', 'invention', 'aviation', 'codex'],
    blurb: 'Leonardo da Vinci’s design for a machine that would fly by flapping its wings.',
    facts: [
      'Leonardo drew designs like this in the late 1400s.',
      'It was never built in his lifetime.',
      'Human muscles are far too weak to fly this way, which nobody could yet have known.',
    ],
    realSize: 'Leonardo imagined a wingspan of many feet', shownAt: 'A model built from his idea',
    tryThis: 'Why do you think he studied birds before drawing this?',
  },
  {
    id: '1948-taxi', title: '1948 Taxi', category: 'machines', prop: 'taxi-cab', scale: 1, yaw: 0.5,
    grades: ALL, subjects: ['history', 'transportation', 'design'],
    aliases: ['car', 'cab', 'automobile', 'yellow cab', 'new york', 'vehicle', '1940s'],
    blurb: 'A rounded postwar New York taxi, all curved steel and chrome.',
    facts: [
      'Yellow became the classic taxi colour after a company chose it for being easy to see.',
      'Cars of this era were often built on a separate steel frame.',
      'This one comes from the app’s 1940s Times Square world.',
    ],
    realSize: 'About 17 feet long', shownAt: 'Life size',
    tryThis: 'Its starter program drives it round the block. Build a road for it.',
    program: 'driveSquare',
  },
  {
    id: 'steam-locomotive', title: 'Steam Locomotive', category: 'machines', builder: 'machines', scale: 1, yaw: -1,
    grades: ALL, subjects: ['history', 'physics', 'engineering'],
    aliases: ['train', 'railroad', 'railway', 'engine', 'industrial revolution', 'boiler', 'piston', 'transcontinental'],
    blurb: 'A 19th-century American steam engine, with its cowcatcher, big funnel and driving rods.',
    facts: [
      'Burning fuel boils water, and steam pushing on pistons turns the wheels.',
      'Water expands to about 1,600 times its volume when it becomes steam.',
      'The first railroad across the United States was completed in 1869.',
    ],
    realSize: 'About 50 feet long with its tender', shownAt: 'About half life size',
    tryThis: 'Its starter program runs it back and forth. Lay out a track for it.',
    program: 'shuttle',
  },
  {
    id: 'wright-flyer', title: 'Wright Flyer', category: 'machines', builder: 'machines', scale: 0.6, yaw: -0.8, pictureElevation: 22,
    grades: ALL, subjects: ['history', 'physics', 'engineering'],
    aliases: ['airplane', 'aeroplane', 'wright brothers', 'orville', 'wilbur', 'kitty hawk', 'aviation', 'biplane', 'first flight'],
    blurb: 'The biplane that made the first powered, controlled, sustained flights in 1903.',
    facts: [
      'Orville Wright flew it for 12 seconds and 120 feet on December 17, 1903.',
      'The longest flight that day lasted 59 seconds and covered 852 feet.',
      'Its wings spanned just over 40 feet. This model\u2019s wires are drawn thicker than life so they can be seen.',
    ],
    realSize: 'About 40 feet across the wings', shownAt: 'About 60% of life size',
    tryThis: 'Its starter program flies a short hop. Can you beat 120 feet?',
    program: 'flyHop',
  },
  {
    id: 'printing-press', title: 'Gutenberg Printing Press', category: 'machines', builder: 'machines', scale: 1, yaw: -0.7,
    grades: UP3, subjects: ['history', 'language arts', 'technology'],
    aliases: ['gutenberg', 'movable type', 'book', 'renaissance', 'bible', 'ink', 'reformation', 'typography'],
    blurb: 'A wooden hand press of the kind that made books affordable across Europe.',
    facts: [
      'Johannes Gutenberg developed printing with movable metal type around 1450.',
      'His famous Bible was printed in the 1450s, in about 180 copies.',
      'The press itself was adapted from presses already used for wine and oil.',
      'No press of Gutenberg\u2019s survives. This is the kind shown in the earliest pictures of printing.',
    ],
    realSize: 'About 6 feet tall', shownAt: 'About life size',
    tryThis: 'Why would cheaper books change who could learn to read?',
  },

  // --- Landmarks ----------------------------------------------------------------------
  {
    id: 'great-sphinx', title: 'Great Sphinx of Giza', category: 'landmarks', builder: 'landmarks', scale: 1, yaw: 0.6, pictureElevation: 12,
    grades: ALL, subjects: ['history', 'world cultures', 'art'],
    aliases: ['egypt', 'giza', 'pharaoh', 'khafre', 'ancient', 'statue', 'limestone', 'lion'],
    blurb: 'A lion with a human head, carved from the limestone of the Giza plateau.',
    facts: [
      'It is about 240 feet long and 66 feet high.',
      'It was carved around 4,500 years ago, and most scholars link it to the pharaoh Khafre.',
      'Its nose has been missing for centuries.',
    ],
    realSize: 'About 240 feet long', shownAt: 'About 1/12 of life size',
    tryThis: 'Place a Pyramid of Giza behind it and arrange them like the real plateau.',
  },
  {
    id: 'pyramid-of-giza', title: 'Great Pyramid of Giza', category: 'landmarks', builder: 'landmarks', scale: 1,
    grades: ALL, subjects: ['history', 'mathematics', 'world cultures'],
    aliases: ['egypt', 'khufu', 'pharaoh', 'ancient', 'wonder', 'tomb', 'geometry', 'cheops'],
    blurb: 'The largest pyramid at Giza, its courses of stone exposed where the casing has gone.',
    facts: [
      'It was built around 2560 BCE for the pharaoh Khufu.',
      'It was the tallest structure on Earth for more than 3,800 years.',
      'It contains an estimated 2.3 million stone blocks.',
    ],
    realSize: 'Originally about 481 feet tall', shownAt: 'About 1/24 of life size',
    tryThis: 'A square base and four triangles: try building one yourself with Create Model.',
  },
  {
    id: 'colosseum', title: 'The Colosseum', category: 'landmarks', prop: 'colosseum', scale: 0.12, yaw: 0.3,
    grades: ALL, subjects: ['history', 'world cultures', 'engineering'],
    aliases: ['rome', 'roman', 'amphitheatre', 'amphitheater', 'gladiator', 'arena', 'ancient', 'arches', 'italy'],
    blurb: 'Rome’s great amphitheatre, tiers of arches round an oval arena.',
    facts: [
      'It opened in the year 80 CE.',
      'It held around 50,000 spectators.',
      'Its oval measures about 615 by 510 feet, and its walls rise about 157 feet.',
    ],
    realSize: 'About 615 feet long', shownAt: 'About 1/25 of life size',
    tryThis: 'Compare its arches with a modern stadium. What has changed, and what has not?',
  },
  {
    id: 'statue-of-liberty', title: 'Statue of Liberty', category: 'landmarks', prop: 'statue-of-liberty', scale: 0.15,
    grades: ALL, subjects: ['history', 'civics', 'art'],
    aliases: ['new york', 'liberty', 'ellis island', 'immigration', 'france', 'bartholdi', 'torch', 'copper', 'america'],
    blurb: 'A gift from the people of France, standing on its pedestal in New York Harbor.',
    facts: [
      'It was dedicated in 1886.',
      'The statue is about 151 feet tall, and about 305 feet from the ground to the torch.',
      'It is copper, and it turned green as the surface weathered.',
    ],
    realSize: 'About 305 feet tall with its pedestal', shownAt: 'About 1/18 of life size',
    tryThis: 'What might it have meant to people arriving by ship at Ellis Island?',
  },
  {
    id: 'taj-mahal', title: 'Taj Mahal', category: 'landmarks', prop: 'taj-mahal', scale: 0.16,
    grades: ALL, subjects: ['history', 'world cultures', 'art'],
    aliases: ['india', 'agra', 'mughal', 'shah jahan', 'mumtaz mahal', 'marble', 'dome', 'mausoleum', 'wonder'],
    blurb: 'The white marble mausoleum built at Agra in memory of Mumtaz Mahal.',
    facts: [
      'The Mughal emperor Shah Jahan commissioned it in memory of his wife, Mumtaz Mahal.',
      'Its main construction was finished around 1653.',
      'It stands about 240 feet tall, and its marble seems to change colour with the light.',
    ],
    realSize: 'About 240 feet tall', shownAt: 'About 1/13 of life size',
    tryThis: 'Look at it from all four sides. What do you notice about its symmetry?',
  },
  {
    id: 'parthenon', title: 'The Parthenon', category: 'landmarks', builder: 'landmarks', scale: 1, yaw: 0.45, pictureElevation: 22,
    grades: ALL, subjects: ['history', 'world cultures', 'art', 'mathematics'],
    aliases: ['greece', 'athens', 'acropolis', 'athena', 'temple', 'doric', 'column', 'ancient', 'classical'],
    blurb: 'The marble temple to Athena on the Acropolis of Athens, roofless and weathered.',
    facts: [
      'It was built between 447 and 432 BCE.',
      'Its outer colonnade has 46 Doric columns: 8 across each end and 17 along each side.',
      'The columns swell slightly, a subtle curve called entasis. It is exaggerated here so you can see it.',
      'All 46 columns stand in this model so they can be counted. On the real temple, parts of the colonnade are broken.',
    ],
    realSize: 'About 228 feet long', shownAt: 'About 1/8 of life size',
    tryThis: 'Count the columns along one side, remembering not to count the corners twice.',
  },
  {
    id: 'medieval-castle', title: 'Medieval Castle', category: 'landmarks', builder: 'landmarks', scale: 1, pictureElevation: 24,
    grades: ALL, subjects: ['history', 'engineering'],
    aliases: ['knight', 'keep', 'moat', 'drawbridge', 'gatehouse', 'portcullis', 'middle ages', 'fortress', 'tower', 'battlement'],
    blurb: 'A stone castle with a central keep, a curtain wall, four towers and a gatehouse.',
    facts: [
      'This is a typical design rather than one particular castle.',
      'A strong central tower called the keep was the last place to hold in an attack.',
      'Round towers have no corners for attackers to undermine, so they are harder to bring down.',
    ],
    realSize: 'A castle like this could be 200 feet across', shownAt: 'About 1/8 of life size',
    tryThis: 'Where would you attack this castle? Where would you defend it?',
  },

  // --- History & Artifacts ------------------------------------------------------------
  {
    id: 'armillary-sphere', title: 'Armillary Sphere', category: 'artifacts', prop: 'armillary-sphere', scale: 0.6,
    grades: UP3, subjects: ['history of science', 'astronomy'],
    aliases: ['astronomy', 'rings', 'celestial', 'ecliptic', 'equator', 'instrument', 'renaissance', 'zodiac'],
    blurb: 'An instrument of rings that models the great circles of the sky around the Earth.',
    facts: [
      'Instruments of rings like this were used in ancient Greece and in ancient China.',
      'Each ring stands for a circle in the sky, such as the celestial equator or the Sun’s yearly path.',
      'This one puts Earth at the centre, as most astronomers did before Copernicus.',
    ],
    realSize: 'Usually from about a foot to several feet tall', shownAt: 'A large display model',
    tryThis: 'Find the tilted ring. It marks the path the Sun appears to follow through the year.',
    program: 'spinSlow',
  },
  {
    id: 'rosetta-stone', title: 'Rosetta Stone', category: 'artifacts', builder: 'artifacts', scale: 1,
    grades: UP3, subjects: ['history', 'language arts', 'world cultures'],
    aliases: ['egypt', 'hieroglyphs', 'hieroglyphics', 'demotic', 'greek', 'champollion', 'translation', 'british museum', 'decree', 'writing'],
    blurb: 'A broken stone slab carrying one decree in three scripts, the key to reading hieroglyphs.',
    facts: [
      'It carries a decree of 196 BCE in hieroglyphs, Demotic and ancient Greek.',
      'It was found in 1799, and Jean-François Champollion announced his decipherment in 1822.',
      'The writing on this model is representative: it shows the three scripts’ look rather than the real text.',
    ],
    realSize: 'About 44 inches tall and weighing about 1,700 pounds', shownAt: 'About twice life size',
    tryThis: 'Why does having the same message in a known language help you read an unknown one?',
  },
  {
    id: 'viking-longship', title: 'Viking Longship', category: 'artifacts', builder: 'artifacts', scale: 0.5, yaw: 0.55, pictureElevation: 12,
    grades: ALL, subjects: ['history', 'world cultures', 'engineering'],
    aliases: ['norse', 'vikings', 'boat', 'ship', 'sail', 'oars', 'scandinavia', 'gokstad', 'clinker', 'leif erikson'],
    blurb: 'A clinker-built Norse ship with a square sail, shields and a row of oar ports.',
    facts: [
      'Overlapping planks made the hull light and flexible.',
      'A shallow hull let longships sail far up rivers as well as across seas.',
      'Norse sailors reached North America around the year 1000.',
    ],
    realSize: 'The Gokstad ship is about 76 feet long', shownAt: 'About 1/3 of life size',
    tryThis: 'Its starter program sails it back and forth. Build it a shore to land on.',
    program: 'shuttle',
  },
  {
    id: 'greek-amphora', title: 'Greek Amphora', category: 'artifacts', builder: 'artifacts', scale: 1,
    grades: ALL, subjects: ['history', 'art', 'world cultures'],
    aliases: ['vase', 'pottery', 'greece', 'ceramic', 'black figure', 'jar', 'ancient', 'clay', 'meander'],
    blurb: 'A two-handled storage jar decorated in the black-figure style.',
    facts: [
      'Amphorae stored and carried wine, olive oil and other goods.',
      'The word means "carried on both sides", after its two handles.',
      'In black-figure painting, figures were painted in slip that turned black in the kiln.',
    ],
    realSize: 'About 1 to 2 feet tall', shownAt: 'Enlarged about 4 times',
    tryThis: 'Stretch it wider and taller. What would each shape be better at holding?',
    program: 'spinSlow',
  },
  {
    id: 'abacus', title: 'Chinese Abacus', category: 'artifacts', builder: 'artifacts', scale: 1, pictureElevation: 10,
    grades: ALL, subjects: ['mathematics', 'history', 'world cultures'],
    aliases: ['suanpan', 'counting', 'calculator', 'math', 'beads', 'place value', 'china', 'soroban', 'arithmetic'],
    blurb: 'A suanpan, the Chinese counting frame, with beads on rods in two decks.',
    facts: [
      'Each rod is one place value, like the columns of a written number.',
      'A bead above the beam counts five, and a bead below counts one.',
      'Skilled users can still calculate astonishingly quickly on one.',
    ],
    realSize: 'About a foot wide', shownAt: 'Enlarged about 6 times',
    tryThis: 'Beads moved to the beam are the ones that count. Which number is it showing?',
    answer: 'It shows 7,295. The rightmost rod is the ones.',
  },
  {
    id: 'covered-wagon', title: 'Covered Wagon', category: 'artifacts', builder: 'artifacts', scale: 1, yaw: 0.5,
    grades: ALL, subjects: ['history', 'geography'],
    aliases: ['oregon trail', 'pioneer', 'prairie schooner', 'westward expansion', 'conestoga', 'kansas', 'frontier', 'oxen'],
    blurb: 'A prairie schooner, the canvas-topped wagon of the overland trails.',
    facts: [
      'The Oregon Trail ran about 2,000 miles, and the journey took around five months.',
      'Most travellers walked beside the wagon to spare the animals.',
      'Oxen were the commonest team, since they were strong and could live on prairie grass.',
    ],
    realSize: 'A box about 10 feet long', shownAt: 'Life size',
    tryThis: 'A wagon could carry about a ton. What would you pack, and what would you leave?',
    program: 'shuttle',
  },

  // --- Arts & Music -------------------------------------------------------------------
  {
    id: 'grand-piano', title: 'Grand Piano', category: 'arts', builder: 'arts', scale: 1, yaw: -0.7, pictureElevation: 24,
    grades: ALL, subjects: ['music', 'physics', 'history'],
    aliases: ['keyboard', 'keys', 'instrument', 'concert', 'cristofori', 'strings', 'hammers'],
    blurb: 'A concert grand with its lid raised, showing the strings and soundboard inside.',
    facts: [
      'Bartolomeo Cristofori built the first pianos in Italy around 1700.',
      'A modern piano has 88 keys: 52 white and 36 black.',
      'Each key throws a felt hammer at its strings, so a piano is both a string and a percussion instrument.',
    ],
    realSize: 'A concert grand is about 9 feet long', shownAt: 'Life size',
    tryThis: 'Look at how the strings get shorter toward the high notes.',
  },
  {
    id: 'violin', title: 'Violin', category: 'arts', builder: 'arts', scale: 1,
    grades: ALL, subjects: ['music', 'physics', 'history'],
    aliases: ['fiddle', 'strings', 'bow', 'stradivari', 'orchestra', 'instrument', 'scroll', 'f hole'],
    blurb: 'A violin and bow on a stand, with its scroll, f-holes and four strings.',
    facts: [
      'Its four strings are tuned to G, D, A and E.',
      'The violin took its modern form in Italy in the 1500s.',
      'Antonio Stradivari’s violins from around 1700 are among the most valued instruments in the world.',
    ],
    realSize: 'About 23 inches long', shownAt: 'Enlarged about 4 times',
    tryThis: 'Why do you think its body is hollow? What would a solid one sound like?',
  },
  {
    id: 'djembe', title: 'Djembe', category: 'arts', builder: 'arts', scale: 1, pictureElevation: 22,
    grades: ALL, subjects: ['music', 'world cultures'],
    aliases: ['drum', 'africa', 'west africa', 'mali', 'percussion', 'instrument', 'goatskin', 'rhythm'],
    blurb: 'A goblet-shaped drum from West Africa, carved from one log and tuned with rope.',
    facts: [
      'The djembe comes from West Africa and is closely linked with the Mandinka people.',
      'It gives three main sounds: a deep bass, a tone and a sharp slap.',
      'Its name is often explained by a saying: "anke djé, anke bé", meaning "everyone gather together".',
    ],
    realSize: 'About 2 feet tall', shownAt: 'Enlarged about 2 times',
    tryThis: 'Its shape works like a bottle. Where does the deep sound come from?',
  },
  {
    id: 'artists-easel', title: 'Artist’s Easel', category: 'arts', builder: 'arts', scale: 1,
    grades: ALL, subjects: ['art', 'history'],
    aliases: ['painting', 'canvas', 'palette', 'brush', 'color wheel', 'colour wheel', 'studio', 'paint'],
    blurb: 'A wooden studio easel holding a canvas, with a palette of mixed paint beside it.',
    facts: [
      'The canvas shows a colour wheel: primary colours, and the secondary colours they mix to make.',
      'Colours opposite each other on the wheel are called complementary.',
      'Easels have been used since at least ancient Egypt.',
    ],
    realSize: 'About 6 feet tall', shownAt: 'Life size',
    tryThis: 'Which two primaries mix to make the colour opposite red?',
  },
];

export const MODEL_BY_ID = new Map(MODELS.map((model) => [model.id, model]));

export function modelCategory(key) {
  return MODEL_CATEGORIES.find((category) => category.key === key);
}

// --- Search ---------------------------------------------------------------------------
//
// Every word has to match somewhere, and a match in a title outranks one in a fact. Words
// match by PREFIX, so "dino" finds dinosaurs while a student is still typing, and only the
// title also matches anywhere in a word, so "rex" finds Tyrannosaurus rex. There is no fuzzy
// matching on purpose: a search that finds the Parthenon for "panther" is harder to trust
// than one that says it found nothing.
const normalise = (text) => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '');
const wordsOf = (text) => normalise(text).split(/[^a-z0-9]+/).filter(Boolean);

function fieldScore(word, words, weight) {
  return words.some((candidate) => candidate.startsWith(word)) ? weight : 0;
}

function searchIndex(model) {
  if (model.searchWords) return model.searchWords;
  const index = {
    title: wordsOf(model.title),
    titleText: normalise(model.title),
    aliases: wordsOf(model.aliases.join(' ')),
    subjects: wordsOf(`${model.subjects.join(' ')} ${modelCategory(model.category)?.label ?? ''}`),
    body: wordsOf(`${model.blurb} ${model.facts.join(' ')}`),
  };
  Object.defineProperty(model, 'searchWords', { value: index, enumerable: false });
  return index;
}

export function searchModels(query, models = MODELS) {
  const words = wordsOf(query);
  if (!words.length) return [...models];
  const scored = [];
  for (const model of models) {
    const index = searchIndex(model);
    let score = 0;
    let everyWord = true;
    for (const word of words) {
      const best = Math.max(
        fieldScore(word, index.title, 10),
        index.titleText.includes(word) ? 6 : 0,
        fieldScore(word, index.aliases, 5),
        fieldScore(word, index.subjects, 3),
        word.length >= 3 ? fieldScore(word, index.body, 1) : 0,
      );
      if (!best) { everyWord = false; break; }
      score += best;
    }
    if (everyWord) scored.push({ model, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.model);
}
