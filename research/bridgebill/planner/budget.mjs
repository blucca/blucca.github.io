function inputText(value) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}

function tickets(value, label, minimum) {
  const text = inputText(value);
  const count = Number(text);
  if (!/^\d+(?:\.0*)?$/.test(text) || !Number.isInteger(count)
      || count < minimum || count > 10000) {
    throw new Error(`${label}: enter a whole number from ${minimum} to 10000.`);
  }
  return count;
}

function hundredths(value, label, minimum, maximum) {
  const text = inputText(value);
  const [whole, fraction = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)
      || !Number.isSafeInteger(amount) || amount < minimum || amount > maximum) {
    throw new Error(`${label}: enter ${minimum / 100} to ${maximum / 100} with up to 2 decimals.`);
  }
  return amount;
}

const ceilDivide = (numerator, denominator) => (numerator + denominator - 1n) / denominator;

/** Calculate one separately ticketed screening; money is returned in integer pence. */
export function calculateBudget(input) {
  const capacity = tickets(input?.capacity, 'Capacity', 1);
  const attendance = tickets(input?.attendance, 'Attendance', 0);
  if (attendance > capacity) {
    throw new Error('Attendance: enter a ticket count within the room capacity.');
  }
  const ticketPricePence = hundredths(input?.ticketPrice, 'Ticket price (£)', 1, 1000000);
  const fixedCostsPence = hundredths(input?.fixedCosts, 'Fixed costs (£)', 0, 100000000);
  const minimumFeePence = hundredths(input?.minimumFee, 'Minimum fee (£)', 0, 100000000);
  const shareBasisPoints = hundredths(input?.sharePercent, 'Licence share (%)', 0, 9999);
  const price = BigInt(ticketPricePence);
  const fixed = BigInt(fixedCostsPence);
  const minimum = BigInt(minimumFeePence);
  const share = BigInt(shareBasisPoints);

  function totals(count) {
    const receipts = BigInt(count) * price;
    const percentageFee = (receipts * share + 5000n) / 10000n;
    const licence = percentageFee > minimum ? percentageFee : minimum;
    return {
      receiptsPence: Number(receipts),
      licencePence: Number(licence),
      surplusPence: Number(receipts - licence - fixed),
    };
  }

  const minimumTickets = ceilDivide(fixed + minimum, price);
  // R - round_half_up(R * share / 10000) >= F exactly when
  // R * (10000 - share) >= 10000 * F - 4999.
  const shareTarget = fixed * 10000n - 4999n;
  const shareTickets = shareTarget > 0n
    ? ceilDivide(shareTarget, price * (10000n - share))
    : 0n;
  const breakEvenTickets = Number(minimumTickets > shareTickets ? minimumTickets : shareTickets);

  return {
    capacity,
    attendance,
    ticketPricePence,
    fixedCostsPence,
    minimumFeePence,
    shareBasisPoints,
    ...totals(attendance),
    breakEvenTickets,
    capacitySurplusPence: totals(capacity).surplusPence,
    feasible: breakEvenTickets <= capacity,
    neededTickets: Math.max(0, breakEvenTickets - attendance),
  };
}
