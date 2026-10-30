// Atom Hall -- every chemistry figure in the world, in one place.
//
// The same rule as MoneyModel.js, MidwayModel.js and CONSTELLATIONS: ONE TABLE feeds the skyline,
// the boards, the programs that ship running and the check tool, and tools/check-atomhall.mjs holds
// the printed lesson cards to the same numbers, because that page is static HTML and nothing else
// would notice it drifting.
//
// Pure arithmetic: this file imports nothing and builds no geometry, so it runs in node.
//
// WHERE THE NUMBERS COME FROM, because a wrong number here is the failure this world cannot afford:
//   Radius: covalent radii from Cordero et al., "Covalent radii revisited", Dalton Trans. 2008. A
//     covalent radius is chosen over the van der Waals one because it keeps the noble gases on the
//     trend. Carbon is the sp3 value; Mn, Fe and Co are the low-spin values. It stops at curium.
//   Electronegativity: the Pauling scale, as tabulated by WebElements and the CRC Handbook. Where
//     sources disagree this table takes those (lead is 2.33, not the 1.87 of its +2 state). Francium
//     is the usual estimate of 0.7. He, Ne, Ar and Rn have no value, and nothing past curium is
//     used, because what is printed beyond it is a convention and not a measurement.
// A MISSING VALUE STAYS MISSING. It is a stump on the skyline and "no value" on its plate, because
// an estimate standing at full height would be indistinguishable from a measurement.

// [Z, symbol, name, column, row, family, covalent radius in pm, Pauling electronegativity]
// Column and row are the 18-column table's. Rows 9 and 10 are the f-block, printed below the table.
const ROWS = [
  [1, 'H', 'Hydrogen', 1, 1, 'nonmetal', 31, 2.20],
  [2, 'He', 'Helium', 18, 1, 'noble', 28, null],
  [3, 'Li', 'Lithium', 1, 2, 'alkali', 128, 0.98],
  [4, 'Be', 'Beryllium', 2, 2, 'alkaline', 96, 1.57],
  [5, 'B', 'Boron', 13, 2, 'metalloid', 84, 2.04],
  [6, 'C', 'Carbon', 14, 2, 'nonmetal', 76, 2.55],
  [7, 'N', 'Nitrogen', 15, 2, 'nonmetal', 71, 3.04],
  [8, 'O', 'Oxygen', 16, 2, 'nonmetal', 66, 3.44],
  [9, 'F', 'Fluorine', 17, 2, 'halogen', 57, 3.98],
  [10, 'Ne', 'Neon', 18, 2, 'noble', 58, null],
  [11, 'Na', 'Sodium', 1, 3, 'alkali', 166, 0.93],
  [12, 'Mg', 'Magnesium', 2, 3, 'alkaline', 141, 1.31],
  [13, 'Al', 'Aluminum', 13, 3, 'post', 121, 1.61],
  [14, 'Si', 'Silicon', 14, 3, 'metalloid', 111, 1.90],
  [15, 'P', 'Phosphorus', 15, 3, 'nonmetal', 107, 2.19],
  [16, 'S', 'Sulfur', 16, 3, 'nonmetal', 105, 2.58],
  [17, 'Cl', 'Chlorine', 17, 3, 'halogen', 102, 3.16],
  [18, 'Ar', 'Argon', 18, 3, 'noble', 106, null],
  [19, 'K', 'Potassium', 1, 4, 'alkali', 203, 0.82],
  [20, 'Ca', 'Calcium', 2, 4, 'alkaline', 176, 1.00],
  [21, 'Sc', 'Scandium', 3, 4, 'transition', 170, 1.36],
  [22, 'Ti', 'Titanium', 4, 4, 'transition', 160, 1.54],
  [23, 'V', 'Vanadium', 5, 4, 'transition', 153, 1.63],
  [24, 'Cr', 'Chromium', 6, 4, 'transition', 139, 1.66],
  [25, 'Mn', 'Manganese', 7, 4, 'transition', 139, 1.55],
  [26, 'Fe', 'Iron', 8, 4, 'transition', 132, 1.83],
  [27, 'Co', 'Cobalt', 9, 4, 'transition', 126, 1.88],
  [28, 'Ni', 'Nickel', 10, 4, 'transition', 124, 1.91],
  [29, 'Cu', 'Copper', 11, 4, 'transition', 132, 1.90],
  [30, 'Zn', 'Zinc', 12, 4, 'transition', 122, 1.65],
  [31, 'Ga', 'Gallium', 13, 4, 'post', 122, 1.81],
  [32, 'Ge', 'Germanium', 14, 4, 'metalloid', 120, 2.01],
  [33, 'As', 'Arsenic', 15, 4, 'metalloid', 119, 2.18],
  [34, 'Se', 'Selenium', 16, 4, 'nonmetal', 120, 2.55],
  [35, 'Br', 'Bromine', 17, 4, 'halogen', 120, 2.96],
  [36, 'Kr', 'Krypton', 18, 4, 'noble', 116, 3.00],
  [37, 'Rb', 'Rubidium', 1, 5, 'alkali', 220, 0.82],
  [38, 'Sr', 'Strontium', 2, 5, 'alkaline', 195, 0.95],
  [39, 'Y', 'Yttrium', 3, 5, 'transition', 190, 1.22],
  [40, 'Zr', 'Zirconium', 4, 5, 'transition', 175, 1.33],
  [41, 'Nb', 'Niobium', 5, 5, 'transition', 164, 1.60],
  [42, 'Mo', 'Molybdenum', 6, 5, 'transition', 154, 2.16],
  [43, 'Tc', 'Technetium', 7, 5, 'transition', 147, 1.90],
  [44, 'Ru', 'Ruthenium', 8, 5, 'transition', 146, 2.20],
  [45, 'Rh', 'Rhodium', 9, 5, 'transition', 142, 2.28],
  [46, 'Pd', 'Palladium', 10, 5, 'transition', 139, 2.20],
  [47, 'Ag', 'Silver', 11, 5, 'transition', 145, 1.93],
  [48, 'Cd', 'Cadmium', 12, 5, 'transition', 144, 1.69],
  [49, 'In', 'Indium', 13, 5, 'post', 142, 1.78],
  [50, 'Sn', 'Tin', 14, 5, 'post', 139, 1.96],
  [51, 'Sb', 'Antimony', 15, 5, 'metalloid', 139, 2.05],
  [52, 'Te', 'Tellurium', 16, 5, 'metalloid', 138, 2.10],
  [53, 'I', 'Iodine', 17, 5, 'halogen', 139, 2.66],
  [54, 'Xe', 'Xenon', 18, 5, 'noble', 140, 2.60],
  [55, 'Cs', 'Cesium', 1, 6, 'alkali', 244, 0.79],
  [56, 'Ba', 'Barium', 2, 6, 'alkaline', 215, 0.89],
  [57, 'La', 'Lanthanum', 3, 9, 'lanthanide', 207, 1.10],
  [58, 'Ce', 'Cerium', 4, 9, 'lanthanide', 204, 1.12],
  [59, 'Pr', 'Praseodymium', 5, 9, 'lanthanide', 203, 1.13],
  [60, 'Nd', 'Neodymium', 6, 9, 'lanthanide', 201, 1.14],
  [61, 'Pm', 'Promethium', 7, 9, 'lanthanide', 199, 1.10],
  [62, 'Sm', 'Samarium', 8, 9, 'lanthanide', 198, 1.17],
  [63, 'Eu', 'Europium', 9, 9, 'lanthanide', 198, 1.10],
  [64, 'Gd', 'Gadolinium', 10, 9, 'lanthanide', 196, 1.20],
  [65, 'Tb', 'Terbium', 11, 9, 'lanthanide', 194, 1.10],
  [66, 'Dy', 'Dysprosium', 12, 9, 'lanthanide', 192, 1.22],
  [67, 'Ho', 'Holmium', 13, 9, 'lanthanide', 192, 1.23],
  [68, 'Er', 'Erbium', 14, 9, 'lanthanide', 189, 1.24],
  [69, 'Tm', 'Thulium', 15, 9, 'lanthanide', 190, 1.25],
  [70, 'Yb', 'Ytterbium', 16, 9, 'lanthanide', 187, 1.10],
  [71, 'Lu', 'Lutetium', 17, 9, 'lanthanide', 187, 1.27],
  [72, 'Hf', 'Hafnium', 4, 6, 'transition', 175, 1.30],
  [73, 'Ta', 'Tantalum', 5, 6, 'transition', 170, 1.50],
  [74, 'W', 'Tungsten', 6, 6, 'transition', 162, 2.36],
  [75, 'Re', 'Rhenium', 7, 6, 'transition', 151, 1.90],
  [76, 'Os', 'Osmium', 8, 6, 'transition', 144, 2.20],
  [77, 'Ir', 'Iridium', 9, 6, 'transition', 141, 2.20],
  [78, 'Pt', 'Platinum', 10, 6, 'transition', 136, 2.28],
  [79, 'Au', 'Gold', 11, 6, 'transition', 136, 2.54],
  [80, 'Hg', 'Mercury', 12, 6, 'transition', 132, 2.00],
  [81, 'Tl', 'Thallium', 13, 6, 'post', 145, 1.62],
  [82, 'Pb', 'Lead', 14, 6, 'post', 146, 2.33],
  [83, 'Bi', 'Bismuth', 15, 6, 'post', 148, 2.02],
  [84, 'Po', 'Polonium', 16, 6, 'post', 140, 2.00],
  [85, 'At', 'Astatine', 17, 6, 'halogen', 150, 2.20],
  [86, 'Rn', 'Radon', 18, 6, 'noble', 150, null],
  [87, 'Fr', 'Francium', 1, 7, 'alkali', 260, 0.70],
  [88, 'Ra', 'Radium', 2, 7, 'alkaline', 221, 0.90],
  [89, 'Ac', 'Actinium', 3, 10, 'actinide', 215, 1.10],
  [90, 'Th', 'Thorium', 4, 10, 'actinide', 206, 1.30],
  [91, 'Pa', 'Protactinium', 5, 10, 'actinide', 200, 1.50],
  [92, 'U', 'Uranium', 6, 10, 'actinide', 196, 1.38],
  [93, 'Np', 'Neptunium', 7, 10, 'actinide', 190, 1.36],
  [94, 'Pu', 'Plutonium', 8, 10, 'actinide', 187, 1.28],
  [95, 'Am', 'Americium', 9, 10, 'actinide', 180, 1.30],
  [96, 'Cm', 'Curium', 10, 10, 'actinide', 169, 1.30],
  [97, 'Bk', 'Berkelium', 11, 10, 'actinide', null, null],
  [98, 'Cf', 'Californium', 12, 10, 'actinide', null, null],
  [99, 'Es', 'Einsteinium', 13, 10, 'actinide', null, null],
  [100, 'Fm', 'Fermium', 14, 10, 'actinide', null, null],
  [101, 'Md', 'Mendelevium', 15, 10, 'actinide', null, null],
  [102, 'No', 'Nobelium', 16, 10, 'actinide', null, null],
  [103, 'Lr', 'Lawrencium', 17, 10, 'actinide', null, null],
  [104, 'Rf', 'Rutherfordium', 4, 7, 'transition', null, null],
  [105, 'Db', 'Dubnium', 5, 7, 'transition', null, null],
  [106, 'Sg', 'Seaborgium', 6, 7, 'transition', null, null],
  [107, 'Bh', 'Bohrium', 7, 7, 'transition', null, null],
  [108, 'Hs', 'Hassium', 8, 7, 'transition', null, null],
  [109, 'Mt', 'Meitnerium', 9, 7, 'unknown', null, null],
  [110, 'Ds', 'Darmstadtium', 10, 7, 'unknown', null, null],
  [111, 'Rg', 'Roentgenium', 11, 7, 'unknown', null, null],
  [112, 'Cn', 'Copernicium', 12, 7, 'transition', null, null],
  [113, 'Nh', 'Nihonium', 13, 7, 'unknown', null, null],
  [114, 'Fl', 'Flerovium', 14, 7, 'post', null, null],
  [115, 'Mc', 'Moscovium', 15, 7, 'unknown', null, null],
  [116, 'Lv', 'Livermorium', 16, 7, 'unknown', null, null],
  [117, 'Ts', 'Tennessine', 17, 7, 'unknown', null, null],
  [118, 'Og', 'Oganesson', 18, 7, 'unknown', null, null],
];

export const ELEMENTS = ROWS.map(([z, symbol, name, column, row, family, radius, en]) => ({
  z, symbol, name, column, row, family, radius, en,
}));

export const elementBySymbol = (symbol) => ELEMENTS.find((e) => e.symbol === symbol);

// Family colours: the tower, its plate and the map board all read these.
export const FAMILIES = {
  alkali: { name: 'Alkali metals', color: '#d9503c' },
  alkaline: { name: 'Alkaline earth metals', color: '#e8892b' },
  transition: { name: 'Transition metals', color: '#d9ab2c' },
  post: { name: 'Post-transition metals', color: '#58ab63' },
  metalloid: { name: 'Metalloids', color: '#2a9f96' },
  nonmetal: { name: 'Other nonmetals', color: '#3d86d6' },
  halogen: { name: 'Halogens', color: '#6a5ad0' },
  noble: { name: 'Noble gases', color: '#a851bf' },
  lanthanide: { name: 'Lanthanides', color: '#d9659a' },
  actinide: { name: 'Actinides', color: '#a56b86' },
  unknown: { name: 'Not yet known', color: '#858a93' },
};

// --- The skyline ------------------------------------------------------------
//
// THE GROUND IS TRUE ZERO, so a tower twice as tall means a value twice as big. Both scales are
// printed on the boards and neither is trimmed to make a trend look steeper.
export const RADIUS_PM_PER_FOOT = 5;
export const EN_FEET_PER_UNIT = 15;
export const TREND_RADIUS = 1;
export const TREND_EN = 2;

// Feet from one tower's centre to the next. A shopfront is 7.4ft wide and the camera sees about 51
// degrees either side, so a street has to be over 6ft for a student to read one from across it.
export const CELL = 14;
export const FBLOCK_GAP = 0.5; // the f-block sits this many rows clear of period 7

export function cellOf({ column, row }) {
  const r = row >= 9 ? row - 1 + FBLOCK_GAP : row;
  return { x: (column - 9.5) * CELL, z: (r - 5) * CELL };
}

// In feet, or null where there is no value to draw.
export function towerHeight(element, trend) {
  if (trend === TREND_EN) return element.en == null ? null : element.en * EN_FEET_PER_UNIT;
  return element.radius == null ? null : element.radius / RADIUS_PM_PER_FOOT;
}

// --- The states-of-matter tank ----------------------------------------------
export const SPEED_PER_ROOT_KELVIN = 0.02; // feet per step, for each unit of the square root of T
export const SOLID = 1;
export const LIQUID = 2;
export const GAS = 3;

// Water, as the tank ships.
export const THERMOSTAT = { temperature: 300, melts: 273, boils: 373 };

export const particleSpeed = (kelvin) => SPEED_PER_ROOT_KELVIN * Math.sqrt(Math.max(0, kelvin));

export function stateAt(kelvin, { melts = THERMOSTAT.melts, boils = THERMOSTAT.boils } = {}) {
  if (kelvin < melts) return SOLID;
  return kelvin < boils ? LIQUID : GAS;
}

// Melting and boiling points at one atmosphere, rounded to the nearest kelvin, in the order a
// student meets them. Salt's are why the salt crystal is in this world.
export const SUBSTANCES = [
  { name: 'Nitrogen', melts: 63, boils: 77 },
  { name: 'Ethanol', melts: 159, boils: 352 },
  { name: 'Water', melts: 273, boils: 373 },
  { name: 'Mercury', melts: 234, boils: 630 },
  { name: 'Table salt', melts: 1074, boils: 1686 },
  { name: 'Iron', melts: 1811, boils: 3134 },
];

// The tank, in feet. x runs along its width, y up from its floor.
export const TANK = { width: 14, height: 10, depth: 3, floorY: 1.6, surface: 5.8, particleRadius: 0.5 };
export const LATTICE = { columns: 6, rows: 4, spacing: 1.5, inset: 0.6 };
// How far inside the glass a particle's centre turns round.
export const WALL_MARGIN = 0.75;

// Each particle's home in the crystal, as (x, y) from the centre of the tank's floor.
export function particleHomes() {
  const homes = [];
  const across = (LATTICE.columns - 1) * LATTICE.spacing;
  for (let row = 0; row < LATTICE.rows; row++) {
    for (let column = 0; column < LATTICE.columns; column++) {
      homes.push({
        x: column * LATTICE.spacing - across / 2,
        y: LATTICE.inset + row * LATTICE.spacing,
        // Three depths, so the tank has a front and a back without losing the crystal's rows.
        z: (((column + row * 2) % 3) - 1) * 0.65,
      });
    }
  }
  return homes;
}

// How far each particle may go, measured from its own home in the crystal, because a particle's
// program counts x and y from where it starts.
export function particleWalls(home) {
  const reach = TANK.width / 2 - WALL_MARGIN;
  return {
    left: -reach - home.x,
    right: reach - home.x,
    floor: LATTICE.inset - home.y,
    roof: TANK.height - WALL_MARGIN - home.y,
    surface: TANK.surface - home.y,
  };
}

// The thermometer: the column stands this many feet tall at the top of its scale.
export const GAUGE = { full: 18, topKelvin: 600 };

// --- The molecules ----------------------------------------------------------
//
// Angstroms. The small ones are built from the measured bond length and angle of the gas-phase
// molecule, so the check tool can hold the geometry to the number on the placard. Ethanol, benzene
// and caffeine are PubChem's computed 3D conformers (CIDs 702, 241 and 2519). [element, x, y, z];
// bonds are [atom, atom, order].
const RAD = Math.PI / 180;

function bent(central, other, length, angle) {
  const half = (angle / 2) * RAD;
  return {
    atoms: [[central, 0, 0, 0],
      [other, Math.sin(half) * length, Math.cos(half) * length, 0],
      [other, -Math.sin(half) * length, Math.cos(half) * length, 0]],
    bonds: [[0, 1, 1], [0, 2, 1]],
  };
}

function pyramid(central, other, length, angle) {
  // Three bonds at `angle` to one another round the axis: solve for their tilt off that axis.
  const sinTilt = (2 / Math.sqrt(3)) * Math.sin((angle / 2) * RAD);
  const tilt = Math.asin(sinTilt);
  const atoms = [[central, 0, 0, 0]];
  const bonds = [];
  for (let i = 0; i < 3; i++) {
    const a = (i * 120 + 90) * RAD;
    atoms.push([other, Math.cos(a) * Math.sin(tilt) * length, -Math.cos(tilt) * length, Math.sin(a) * Math.sin(tilt) * length]);
    bonds.push([0, i + 1, 1]);
  }
  return { atoms, bonds };
}

function tetrahedron(central, other, length) {
  const k = length / Math.sqrt(3);
  return {
    atoms: [[central, 0, 0, 0], [other, k, k, k], [other, -k, -k, k], [other, -k, k, -k], [other, k, -k, -k]],
    bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]],
  };
}

const PUBCHEM = {
  ethanol: {
    atoms: [['O', -1.171, 0.3, 0], ['C', -0.046, -0.567, 0], ['C', 1.218, 0.267, 0], ['H', -0.096, -1.212, 0.882], ['H', -0.095, -1.194, -0.895], ['H', 2.105, -0.372, -0.018], ['H', 1.243, 0.931, -0.87], ['H', 1.262, 0.905, 0.889], ['H', -1.129, 0.836, 0.81]],
    bonds: [[0, 1, 1], [0, 8, 1], [1, 2, 1], [1, 3, 1], [1, 4, 1], [2, 5, 1], [2, 6, 1], [2, 7, 1]],
  },
  benzene: {
    atoms: [['C', -1.213, -0.688, 0], ['C', -1.203, 0.706, 0], ['C', -0.01, -1.395, 0], ['C', 0.01, 1.395, 0], ['C', 1.203, -0.706, 0], ['C', 1.213, 0.688, 0], ['H', -2.158, -1.224, 0], ['H', -2.139, 1.256, 0], ['H', -0.018, -2.481, 0], ['H', 0.018, 2.481, 0], ['H', 2.139, -1.256, 0], ['H', 2.158, 1.224, 0]],
    bonds: [[0, 1, 1.5], [0, 2, 1.5], [0, 6, 1], [1, 3, 1.5], [1, 7, 1], [2, 4, 1.5], [2, 8, 1], [3, 5, 1.5], [3, 9, 1], [4, 5, 1.5], [4, 10, 1], [5, 11, 1]],
  },
  caffeine: {
    atoms: [['O', 0.47, 2.569, 0.001], ['O', -3.127, -0.444, 0], ['N', -0.969, -1.312, 0], ['N', 2.218, 0.141, 0], ['N', -1.348, 1.08, 0], ['N', 1.412, -1.937, 0], ['C', 0.858, 0.259, -0.001], ['C', 0.39, -1.026, 0], ['C', 0.031, 1.422, -0.001], ['C', -1.906, -0.249, 0], ['C', 2.503, -1.2, 0], ['C', -1.428, -2.696, 0.001], ['C', 3.193, 1.206, 0], ['C', -2.297, 2.188, 0.001], ['H', 3.516, -1.579, 0.001], ['H', -1.045, -3.197, -0.894], ['H', -2.519, -2.76, 0.001], ['H', -1.045, -3.196, 0.896], ['H', 4.199, 0.78, 0], ['H', 3.047, 1.809, -0.899], ['H', 3.047, 1.808, 0.9], ['H', -1.809, 3.165, 0], ['H', -2.932, 2.103, 0.888], ['H', -2.935, 2.102, -0.885]],
    bonds: [[0, 8, 2], [1, 9, 2], [2, 7, 1], [2, 9, 1], [2, 11, 1], [3, 6, 1], [3, 10, 1], [3, 12, 1], [4, 8, 1], [4, 9, 1], [4, 13, 1], [5, 7, 1], [5, 10, 2], [6, 7, 2], [6, 8, 1], [10, 14, 1], [11, 15, 1], [11, 16, 1], [11, 17, 1], [12, 18, 1], [12, 19, 1], [12, 20, 1], [13, 21, 1], [13, 22, 1], [13, 23, 1]],
  },
};

export const MOLECULE_SCALE = 5; // feet per angstrom

export const MOLECULES = {
  water: {
    name: 'Water', formula: 'H2O', length: 0.958, angle: 104.5, lonePairs: 2, ...bent('O', 'H', 0.958, 104.5),
  },
  carbonDioxide: {
    name: 'Carbon dioxide',
    formula: 'CO2',
    length: 1.16,
    angle: 180,
    lonePairs: 0,
    atoms: [['C', 0, 0, 0], ['O', 1.16, 0, 0], ['O', -1.16, 0, 0]],
    bonds: [[0, 1, 2], [0, 2, 2]],
  },
  methane: {
    name: 'Methane', formula: 'CH4', length: 1.087, angle: 109.5, lonePairs: 0, ...tetrahedron('C', 'H', 1.087),
  },
  ammonia: {
    name: 'Ammonia', formula: 'NH3', length: 1.012, angle: 106.7, lonePairs: 1, ...pyramid('N', 'H', 1.012, 106.7),
  },
  ethanol: { name: 'Ethanol', formula: 'C2H5OH', lonePairs: 0, ...PUBCHEM.ethanol },
  benzene: { name: 'Benzene', formula: 'C6H6', ring: 1.39, lonePairs: 0, ...PUBCHEM.benzene },
  caffeine: { name: 'Caffeine', formula: 'C8H10N4O2', lonePairs: 0, ...PUBCHEM.caffeine },
};

// The angle at atom b, in degrees, between atoms a and c.
export function angleAt(molecule, a, b, c) {
  const [, ax, ay, az] = molecule.atoms[a];
  const [, bx, by, bz] = molecule.atoms[b];
  const [, cx, cy, cz] = molecule.atoms[c];
  const u = [ax - bx, ay - by, az - bz];
  const v = [cx - bx, cy - by, cz - bz];
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  return Math.acos(dot / (Math.hypot(...u) * Math.hypot(...v))) / RAD;
}

export const bondLength = (molecule, a, b) => {
  const [, ax, ay, az] = molecule.atoms[a];
  const [, bx, by, bz] = molecule.atoms[b];
  return Math.hypot(ax - bx, ay - by, az - bz);
};

// Feet per metre over metres per angstrom, as "about N billion times life size".
export const enlargement = (feetPerAngstrom) => (feetPerAngstrom * 0.3048) / 1e-10;

// Standard ball-and-stick colours, drawn at about a third of each atom's real radius so the bonds
// can be seen. Carbon is charcoal rather than black, because this app has no way to light black.
export const ATOM_STYLE = {
  H: { color: 0xf1f1ee, ball: 0.26 },
  C: { color: 0x41454d, ball: 0.38 },
  N: { color: 0x2f5fd8, ball: 0.36 },
  O: { color: 0xd63a30, ball: 0.36 },
};

// --- The salt crystal -------------------------------------------------------
//
// Rock salt: a = 5.64 angstroms, so neighbouring ions are 2.82 apart. Shannon's six-coordinate
// ionic radii are 1.02 for Na+ and 1.81 for Cl-, which add to 2.83: in the packed half of the
// crystal the ions really do touch at their true sizes. The scale is set so a student can walk
// through the open half: 7ft from one ion to the next.
export const SALT = {
  a: 5.64,
  spacingAngstroms: 2.82,
  naRadius: 1.02,
  clRadius: 1.81,
  spacing: 7,
  ionsPerEdge: 6,
  openRadiusFraction: 0.32,
};
export const SALT_SCALE = SALT.spacing / SALT.spacingAngstroms;

// How many ions a cube of salt one millimetre on a side holds: 8 for each unit cell.
export function ionsInSaltGrain(millimetres = 1) {
  const metres = millimetres / 1000;
  return ((metres / (SALT.a * 1e-10)) ** 3) * 8;
}
