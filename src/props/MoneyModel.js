// Small Change -- every financial figure in the world, in one place.
//
// The same rule as CONSTELLATIONS in SkyProps.js: ONE TABLE feeds the boards, the programs
// that ship running, and the check tool, so a figure on a board cannot disagree with the
// program standing next to it (MoneyPrograms.js, which writes its blocks from these tables). No
// figure in the layout is typed by hand; they all come out of the functions below. tools/check-smallchange.mjs recomputes them and then holds the
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
