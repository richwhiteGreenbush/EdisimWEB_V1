import {
  setv, change, calc, random, forever, repeat, until, when, whenSaid, wait, both, say, size, opacity,
  markerColor, markerDown, markerUp, programSteps,
} from '../BlockKit.js';
import { PAY, SUBSCRIPTIONS, GROW, CARD, RISK, INVEST } from './MoneyModel.js';

// Small Change's programs, all in blocks. The variables at the top of each one are the
// assumptions of a financial model: click the exhibit, press Program, change a number, press
// Save. Each value is written from MoneyModel's tables and never retyped, so a program cannot
// quote a different rate from the board beside it. tools/check-smallchange.mjs runs every one of
// these through the real block runner and compares what it says with the model.
//
// Builders rather than constants, because two objects must not share one tree of block ids.

const FICA = Number((PAY.socialSecurity + PAY.medicare).toFixed(4));

export const PROGRAMS = {
  paycheck: () => [
    setv('wage', PAY.wage),
    setv('hours', PAY.hours),
    calc('gross', 'wage', '*', 'hours'),
    calc('fica', 'gross', '*', FICA),
    calc('federal', 'gross', '*', PAY.federalExample),
    calc('state', 'gross', '*', PAY.stateExample),
    calc('tax', 'federal', '+', 'state'),
    calc('afterFica', 'gross', '-', 'fica'),
    calc('net', 'afterFica', '-', 'tax'),
    calc('ficaSize', 'afterFica', '/', 'gross'),
    calc('ficaSize', 'ficaSize', '*', 100),
    calc('netSize', 'net', '/', 'gross'),
    calc('netSize', 'netSize', '*', 100),
    forever(
      size(100),
      say('Gross pay: ${gross}'),
      wait(3),
      size('ficaSize'),
      say('FICA takes ${fica}'),
      wait(3),
      size('netSize'),
      say('Income tax takes ${tax}'),
      wait(3),
      say('Take-home pay: ${net}'),
      wait(3.4),
    ),
  ],

  // One `change` block per subscription: adding your own is adding a block.
  subscriptions: () => [
    setv('monthly', 0),
    ...SUBSCRIPTIONS.map((price) => change('monthly', price)),
    calc('yearly', 'monthly', '*', 12),
    forever(
      setv('spent', 0),
      setv('month', 1),
      repeat(12,
        change('spent', 'monthly'),
        calc('height', 'spent', '/', 'yearly'),
        calc('height', 'height', '*', 100),
        size('height'),
        say('Month {month}: ${spent}'),
        wait(1),
        change('month', 1)),
      wait(3),
    ),
  ],

  sprout: (startAge) => [
    setv('rate', GROW.rate),
    setv('startAge', startAge),
    setv('firstAge', GROW.earlyAge),
    setv('endAge', GROW.retireAge),
    calc('growth', 1, '+', 'rate'),
    forever(
      setv('balance', 1),
      size(100),
      setv('age', 'firstAge'),
      until('age', '>', 'endAge',
        when('age', '>', 'startAge', calc('balance', 'balance', '*', 'growth')),
        calc('height', 'balance', '*', 100),
        size('height'),
        calc('fifth', 'age', 'mod', 5),
        when('fifth', '=', 0, say('Age {age}: $1 is now ${balance}')),
        wait(0.35),
        change('age', 1)),
      wait(6),
    ),
  ],

  iceCube: () => [
    setv('inflation', GROW.inflation),
    setv('years', 24),
    calc('rise', 1, '+', 'inflation'),
    forever(
      setv('year', 0),
      until('year', '>', 'years',
        calc('prices', 'rise', '^', 'year'),
        calc('buys', 100, '/', 'prices'),
        size('buys'),
        calc('sixth', 'year', 'mod', 6),
        when('sixth', '=', 0, say('Year {year}: $100 buys ${buys} of stuff')),
        wait(0.5),
        change('year', 1)),
      wait(5),
      size(100),
    ),
  ],

  debt: (payment = 15) => [
    setv('balance', CARD.balance),
    setv('apr', CARD.apr),
    setv('payment', payment),
    calc('monthRate', 'apr', '/', 12),
    calc('growth', 1, '+', 'monthRate'),
    forever(
      setv('debt', 'balance'),
      setv('paid', 0),
      setv('month', 0),
      opacity(100),
      size(100),
      wait(2),
      repeat(60,
        when('debt', '>', 0,
          change('month', 1),
          calc('debt', 'debt', '*', 'growth'),
          calc('debt', 'debt', '-', 'payment'),
          change('paid', 'payment'),
          when('debt', '>', 0,
            calc('height', 'debt', '/', 'balance'),
            calc('height', 'height', '*', 100),
            size('height'),
            say('Month {month}: you still owe ${debt}')),
          // The last payment is smaller: `debt` is the overpayment here, and it is negative.
          when('debt', '<=', 0,
            change('paid', 'debt'),
            opacity(0),
            say('Paid off in {month} months. Total paid: ${paid}')),
          wait(0.5))),
      wait(5),
    ),
  ],

  accident: () => [
    forever(wait(12), say('accident')),
  ],

  rainyDay: (insured = 0) => [
    setv('startSavings', RISK.savings),
    setv('repair', RISK.repair),
    setv('deductible', RISK.deductible),
    setv('insured', insured),
    setv('savings', 'startSavings'),
    whenSaid('accident',
      when('insured', '=', 1, setv('cost', 'deductible')),
      when('insured', '=', 0, setv('cost', 'repair')),
      calc('savings', 'savings', '-', 'cost'),
      calc('savings', 'savings', 'max', 0),
      calc('height', 'savings', '/', 'startSavings'),
      calc('height', 'height', '*', 100),
      calc('height', 'height', 'max', 1),
      size('height'),
      say('You paid ${cost}. Left: ${savings}'),
      wait(5),
      setv('savings', 'startSavings'),
      size(100)),
  ],

  market: (colorHex, holdings) => [
    setv('holdings', holdings),
    setv('meanReturn', INVEST.mean),
    setv('swing', INVEST.swing),
    setv('feetPerYear', 1.25),
    setv('ceiling', 36),
    setv('value', 1),
    calc('stepX', 'feetPerYear', '/', 5),
    markerColor(colorHex),
    markerDown(),
    repeat(INVEST.years,
      setv('total', 0),
      repeat('holdings',
        random('a', 0, 1),
        random('b', 0, 1),
        calc('luck', 'a', '+', 'b'),
        calc('luck', 'luck', '-', 1),
        calc('luck', 'luck', '*', 'swing'),
        change('total', 'meanReturn'),
        change('total', 'luck')),
      calc('yearReturn', 'total', '/', 'holdings'),
      calc('growth', 1, '+', 'yearReturn'),
      calc('next', 'value', '*', 'growth'),
      calc('next', 'next', 'max', 0.05),
      calc('oldY', 'value', 'min', 'ceiling'),
      calc('newY', 'next', 'min', 'ceiling'),
      calc('stepY', 'newY', '-', 'oldY'),
      calc('stepY', 'stepY', '/', 5),
      // Five small steps draw a smooth line.
      repeat(5, both('stepX', 'stepY')),
      setv('value', 'next'),
      wait(0.15)),
    markerUp(),
    say('$1 became ${value} (companies: {holdings})'),
  ],
};

// The parts each station's board shows, as rows off the real blocks.
export const BOARD_STEPS = {
  paycheck: () => programSteps([
    setv('wage', PAY.wage),
    setv('hours', PAY.hours),
    calc('gross', 'wage', '*', 'hours'),
    calc('fica', 'gross', '*', FICA),
    calc('federal', 'gross', '*', PAY.federalExample),
    calc('state', 'gross', '*', PAY.stateExample),
  ]),
  subscriptions: () => programSteps([
    setv('monthly', 0),
    ...SUBSCRIPTIONS.map((price) => change('monthly', price)),
    calc('yearly', 'monthly', '*', 12),
  ]),
  compounding: () => programSteps([
    setv('rate', GROW.rate),
    setv('startAge', GROW.earlyAge),
    calc('growth', 1, '+', 'rate'),
    when('age', '>', 'startAge', calc('balance', 'balance', '*', 'growth')),
    calc('height', 'balance', '*', 100),
    size('height'),
  ]),
  debt: () => programSteps([
    setv('payment', 15),
    calc('debt', 'debt', '*', 'growth'),
    calc('debt', 'debt', '-', 'payment'),
    calc('height', 'debt', '/', 'balance'),
    size('height'),
  ]),
  emergency: () => programSteps([
    setv('insured', 0),
    setv('repair', RISK.repair),
    setv('deductible', RISK.deductible),
    when('insured', '=', 1, setv('cost', 'deductible')),
    when('insured', '=', 0, setv('cost', 'repair')),
    calc('savings', 'savings', '-', 'cost'),
  ]),
  diversify: () => programSteps([
    setv('holdings', 1),
    repeat('holdings',
      random('a', 0, 1),
      change('total', 'luck')),
    calc('yearReturn', 'total', '/', 'holdings'),
  ]),
};
