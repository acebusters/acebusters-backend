import { Type } from 'poker-helper';
import { BadRequest } from './errors';

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

export const calcLeaveExitHand = (helper, hand, receipt) => receipt.handId;

export const getIsTurn = (helper, hand, receipt) => {
  try {
    return helper.isTurn(
      hand.lineup,
      hand.dealer,
      hand.state,
      hand.sb * 2,
      receipt.signer,
    );
  } catch (err) {
    // we can not determine turn
    return undefined;
  }
};

export const getPrevReceipt = (helper, rc, receipt, hand, pos) => {
  if (hand.lineup[pos].last) {
    const prevReceipt = rc.get(hand.lineup[pos].last);
    if (prevReceipt.type === Type.FOLD) {
      throw new BadRequest('no bet after fold.');
    }

    if (prevReceipt.type === Type.SIT_OUT) {
      if (hand.state !== 'waiting' && hand.state !== 'dealing') {
        if (receipt.type === Type.SIT_OUT && typeof hand.lineup[pos].sitout === 'number') {
          throw new BadRequest('can not toggle sitout in same hand.');
        }
        if (prevReceipt.amount > 0 && prevReceipt.amount > 0) {
          throw new BadRequest('wait for next hand.');
        }
      }
    }

    return prevReceipt;
  }

  return undefined;
};

export const checks = [
  Type.CHECK_FLOP,
  Type.CHECK_PRE,
  Type.CHECK_RIVER,
  Type.CHECK_TURN,
];

export const validateCheck = (hand, receipt) => {
  if (receipt.type === Type.CHECK_PRE && hand.state !== 'preflop') {
    throw new BadRequest('check only during preflop.');
  }

  if (receipt.type === Type.CHECK_FLOP && hand.state !== 'flop') {
    throw new BadRequest('checkFlop only during flop.');
  }

  if (receipt.type === Type.CHECK_TURN && hand.state !== 'turn') {
    throw new BadRequest('checkTurn only during turn.');
  }

  if (receipt.type === Type.CHECK_RIVER && hand.state !== 'river') {
    throw new BadRequest('checkRiver only during river.');
  }
};
