export const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';

export function seatIsEmpty(seat) {
  return !seat.address || seat.address === EMPTY_ADDR;
}

export function getNextDealer(helper, hand) {
  try {
    return helper.nextPlayer(hand.lineup, hand.dealer, 'active');
  } catch (err) {
    return 0;
  }
}

export function now(secs = 0) {
  return Math.floor(Date.now() / 1000) + secs;
}
