// Small Change -- every financial figure in the world, in one place.
//
// The same rule as CONSTELLATIONS in SkyProps.js: ONE TABLE feeds the boards, the programs
// that ship running, and the check tool, so a figure on a board cannot disagree with the
// program standing next to it. No figure in the layout is typed by hand; they all come out
// of the functions below. tools/check-smallchange.mjs recomputes them and then holds the
// printed lesson card (EdusimWorldDatabase/lib/lessons/small-change.html) to the same numbers, because that page
// is static HTML and nothing else would notice it drifting.
//
// Pure arithmetic: this file imports nothing and builds no geometry, so it runs in node.
//
// EVERY RATE HERE IS A CLASSROOM EXAMPLE and is labelled as one wherever a student reads it.
// Real rates move, and a world file cannot be updated once it is in somebody's hands (the
// "a constant inside a saved record is not a constant" lesson), so nothing in this world
// claims to be today's rate. The two exceptions are the ones that are law or published
// arithmetic rather than a market price: FICA's 7.65% and FICO's five category weights.

export const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
export const cents = (n) => `$${n.toFixed(2)}`;

// --- Station 1: the first paycheck ----------------------------------------
export const PAY = {
  wage: 15,
  hours: 40, // a two-week check at 20 hours a week
  socialSecurity: 0.062,
  medicare: 0.0145,
  federalExample: 0.05,
  stateExample: 0.03,
};

export function paycheck({ wage = PAY.wage, hours = PAY.hours } = {}) {
  const gross = wage * hours;
  const socialSecurity = gross * PAY.socialSecurity;
  const medicare = gross * PAY.medicare;
  const federal = gross * PAY.federalExample;
  const state = gross * PAY.stateExample;
  const net = gross - socialSecurity - medicare - federal - state;
  return { gross, socialSecurity, medicare, fica: socialSecurity + medicare, federal, state, net };
}

// 26 two-week checks over 12 months, rounded to the figure the budget board uses.
export const MONTHLY_TAKE_HOME = 1100;

// --- Station 2: the first budget --------------------------------------------
export const BUDGET = { needs: 0.5, wants: 0.3, savings: 0.2 };

export function budget(takeHome = MONTHLY_TAKE_HOME) {
  return {
    needs: takeHome * BUDGET.needs,
    wants: takeHome * BUDGET.wants,
    savings: takeHome * BUDGET.savings,
  };
}

export const SUBSCRIPTIONS = [10.99, 11.99, 5.99, 8.99];

export function subscriptionCost(list = SUBSCRIPTIONS) {
  const monthly = list.reduce((sum, price) => sum + price, 0);
  return { monthly, yearly: monthly * 12 };
}

export function buyNowPayLater({ price = 100, payments = 4, plans = 5 } = {}) {
  const each = price / payments;
  const dueEveryTwoWeeks = each * plans;
  return { each, dueEveryTwoWeeks, shareOfCheck: dueEveryTwoWeeks / paycheck().net };
}

// --- Station 3: saving, compounding and inflation ---------------------------
export const GROW = { rate: 0.07, inflation: 0.03, monthly: 100, retireAge: 65, earlyAge: 18, lateAge: 28 };

export const growthFactor = (rate, years) => (1 + rate) ** years;

// Contributions at the end of each year, compounded yearly: the simple form a student can
// check on a calculator with the Algebra II geometric series.
export function savedBy({ startAge, monthly = GROW.monthly, rate = GROW.rate, retireAge = GROW.retireAge }) {
  const years = retireAge - startAge;
  const yearly = monthly * 12;
  const balance = yearly * (((1 + rate) ** years - 1) / rate);
  const paidIn = yearly * years;
  return { years, balance, paidIn, growth: balance - paidIn };
}

export const doublingYears = (rate) => 72 / (rate * 100);

export function buyingPower({ amount = 100, inflation = GROW.inflation, years = 24 } = {}) {
  return amount / (1 + inflation) ** years;
}

// --- Station 4: credit ------------------------------------------------------
export const CARD = { balance: 500, apr: 0.24 };

// Month by month: interest first, then the payment. Returns null when the payment never
// gets ahead of the interest -- which at $10 on this balance it exactly fails to do.
export function payoff({ balance = CARD.balance, apr = CARD.apr, payment }) {
  const monthlyRate = apr / 12;
  if (payment <= balance * monthlyRate + 1e-9) return null;
  let left = balance;
  let months = 0;
  let paid = 0;
  while (left > 0.005 && months < 2000) {
    left += left * monthlyRate;
    const pay = Math.min(payment, left);
    left -= pay;
    paid += pay;
    months++;
  }
  return { months, paid, interest: paid - balance };
}

export function carLoan({ principal = 20000, apr, months }) {
  const r = apr / 12;
  const payment = (principal * r) / (1 - (1 + r) ** -months);
  const total = payment * months;
  return { months, apr, payment, total, interest: total - principal };
}

export const CAR_SHORT = { apr: 0.06, months: 48 };
export const CAR_LONG = { apr: 0.12, months: 84 };

// FICO's own published category weights.
export const SCORE_FACTORS = [
  { label: 'Payment history', pct: 35 },
  { label: 'Amounts owed', pct: 30 },
  { label: 'Length of credit history', pct: 15 },
  { label: 'New credit', pct: 10 },
  { label: 'Credit mix', pct: 10 },
];

// --- Station 5: risk --------------------------------------------------------
export const RISK = { savings: 1000, repair: 900, deductible: 200, premiumMonthly: 15 };

export function insuranceCompare({ repair = RISK.repair, deductible = RISK.deductible, savings = RISK.savings } = {}) {
  return {
    leftUninsured: savings - repair,
    leftInsured: savings - deductible,
    premiumYearly: RISK.premiumMonthly * 12,
  };
}

// --- Station 6: investing ---------------------------------------------------
export const INVEST = { mean: 0.07, swing: 0.8, years: 40 };

export function feeDrag({ start = 10000, rate = INVEST.mean, fee = 0.01, years = INVEST.years } = {}) {
  const noFee = start * (1 + rate) ** years;
  const withFee = start * (1 + rate - fee) ** years;
  return { noFee, withFee, lost: noFee - withFee, lostShare: 1 - withFee / noFee };
}

// --- What $ looks like at this world's scale --------------------------------
export const SCALE = 60;
const QUARTER_THICKNESS_FT = (1.75 / 304.8) * SCALE;
export const QUARTER_THICK = QUARTER_THICKNESS_FT;
export const QUARTER_RADIUS = ((24.26 / 2) / 304.8) * SCALE;
export const stackFeet = (dollars) => dollars * 4 * QUARTER_THICKNESS_FT;

// ---------------------------------------------------------------------------
// The programs that ship running
// ---------------------------------------------------------------------------
//
// Real JavaScript a student opens and edits, so the names at the top of each one are the
// assumptions of a financial model: change a number, press Save, watch what happens. Each
// constant is written from the tables above -- never retyped -- so the program cannot quote a
// different rate from the board beside it.

export const PROGRAMS = {
  paycheck: `// Open me and change the wage or the hours.
const wage = ${PAY.wage};
const hours = ${PAY.hours};            // one two-week paycheck
const gross = wage * hours;
const fica = gross * ${(PAY.socialSecurity + PAY.medicare).toFixed(4)};  // Social Security + Medicare
const federal = gross * ${PAY.federalExample};   // example rate: yours depends on your W-4
const state = gross * ${PAY.stateExample};     // example rate: varies by state
const net = gross - fica - federal - state;

await forever(async () => {
  await setSize(100);
  await say('Gross pay: $' + gross.toFixed(2));
  await wait(3);
  await setSize((gross - fica) / gross * 100);
  await say('FICA takes $' + fica.toFixed(2));
  await wait(3);
  await setSize((gross - fica - federal - state) / gross * 100);
  await say('Income tax takes $' + (federal + state).toFixed(2));
  await wait(3);
  await say('Take-home pay: $' + net.toFixed(2));
  await wait(3.4);
});
`,

  subscriptions: `// Every subscription you pay for, per month. Add your own.
const subscriptions = [${SUBSCRIPTIONS.join(', ')}];

const monthly = subscriptions.reduce((sum, price) => sum + price, 0);

await forever(async () => {
  let spent = 0;
  for (let month = 1; month <= 12; month++) {
    spent += monthly;
    await setSize(spent / (monthly * 12) * 100);
    await say('Month ' + month + ': $' + spent.toFixed(2));
    await wait(1);
  }
  await wait(3);
});
`,

  sprout: (startAge) => `// A one-time deposit, growing a little every year.
const rate = ${GROW.rate};      // 7% is an example, not a promise
const startAge = ${startAge};    // the age this money goes in
const firstAge = ${GROW.earlyAge};    // both sprouts share one clock
const endAge = ${GROW.retireAge};

await forever(async () => {
  let balance = 1;              // every $1 you put in
  await setSize(100);
  for (let age = firstAge; age <= endAge; age++) {
    if (age > startAge) balance = balance * (1 + rate);
    await setSize(balance * 100);
    if (age % 5 === 0) await say('Age ' + age + ': $1 is now $' + balance.toFixed(2));
    await wait(0.35);
  }
  await wait(6);
});
`,

  iceCube: `// Cash in a drawer earns nothing, and prices keep rising.
const inflation = ${GROW.inflation};   // 3% is an example
const years = 24;

await forever(async () => {
  for (let year = 0; year <= years; year++) {
    const buys = 100 / Math.pow(1 + inflation, year);
    await setSize(buys);
    if (year % 6 === 0) await say('Year ' + year + ': $100 buys $' + buys.toFixed(0) + ' of stuff');
    await wait(0.5);
  }
  await wait(5);
  await setSize(100);
});
`,

  debt: `// Change the payment and press Save.
const balance = ${CARD.balance};     // bought on a card
const apr = ${CARD.apr};       // 24% a year is 2% a month
const payment = 15;     // try 10, then 25, then 50

await forever(async () => {
  let debt = balance;
  let paid = 0;
  await setOpacity(100);
  await setSize(100);
  await wait(2);
  for (let month = 1; month <= 60 && debt > 0; month++) {
    debt = debt * (1 + apr / 12) - payment;
    paid = paid + payment;
    if (debt > 0) {
      await setSize(debt / balance * 100);
      await say('Month ' + month + ': you still owe $' + debt.toFixed(0));
    } else {
      paid = paid + debt;     // the last payment is smaller
      await setOpacity(0);
      await say('Paid off in ' + month + ' months. Total paid: $' + paid.toFixed(0));
    }
    await wait(0.5);
  }
  await wait(5);
});
`,

  accident: `// Something goes wrong about every 12 seconds. It always does.
await forever(async () => {
  await wait(12);
  await say('accident');
});
`,

  rainyDay: `// Your emergency fund. Try insured = true.
const startingSavings = ${RISK.savings};
const repair = ${RISK.repair};         // what the accident costs
const insured = false;
const deductible = ${RISK.deductible};     // what you pay if you are insured

let savings = startingSavings;
whenSaid('accident', async () => {
  const cost = insured ? deductible : repair;
  savings = Math.max(0, savings - cost);
  await setSize(Math.max(1, savings / startingSavings * 100));
  await say('You paid $' + cost + '. Left: $' + savings);
  await wait(5);
  savings = startingSavings;
  await setSize(100);
});
`,

  market: (color, holdings) => `// $1 invested for ${INVEST.years} years. Every run is different.
const holdings = ${holdings};        // how many companies you own: try 1, 5, 20
const meanReturn = ${INVEST.mean};  // an example average, not a promise
const swing = ${INVEST.swing};       // how hard one company's year can swing

const luck = () => Math.random() + Math.random() - 1;
const feetPerYear = 1.25;
const feetPerDollar = 1;
const ceiling = 36;          // the top of the graph paper
const height = (v) => Math.min(ceiling, v) * feetPerDollar;

let value = 1;
await markerColor('${color}');
await markerDown();
await repeat(${INVEST.years}, async () => {
  let yearReturn = 0;
  for (let i = 0; i < holdings; i++) yearReturn += meanReturn + swing * luck();
  yearReturn = yearReturn / holdings;

  const next = Math.max(0.05, value * (1 + yearReturn));
  const rise = height(next) - height(value);
  await repeat(5, async () => {        // five small steps draw a smooth line
    await moveUp(rise / 5);
    await moveForward(feetPerYear / 5);
  });
  value = next;
  await wait(0.15);
});
await markerUp();
await say('$1 became $' + value.toFixed(2) + ' (' + holdings + ' holding' + (holdings > 1 ? 's' : '') + ')');
`,
};
