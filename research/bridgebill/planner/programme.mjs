// One familiar entrance and one partner choice. Locks keep the operator in charge.
export function chooseProgramme(rankings, current, locks = [false, false]) {
  if (!Array.isArray(current) || current.length !== 2 || !Array.isArray(locks) || locks.length !== 2) throw new Error('Supply two screening slots and two locks.');
  const first = (rows, except) => rows.find(row => row.slug !== except)?.slug;
  const pair = [...current];
  if (!locks[0]) pair[0] = first(rankings.regular.rows, locks[1] ? pair[1] : null);
  if (!locks[1]) pair[1] = first(rankings.partner.rows, pair[0]);
  if (!pair.every(Boolean)) throw new Error('The shelf needs two distinct available films.');
  if (pair[0] === pair[1]) throw new Error('Select two different films, or unlock a screening.');
  return pair;
}

export const partnerLabels = { book_club: 'Book club', record_shop: 'Record shop' };
export const partnerAnchors = {
  book_club: ['White Teeth — Zadie Smith', 'Norwegian Wood — Haruki Murakami'],
  record_shop: ['Talking Heads', 'David Bowie', 'Nina Simone'],
};
