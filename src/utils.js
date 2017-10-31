// return all detected leaves
export const leavesReceived = (oldHand, newHand) => (
  newHand.lineup
    .map((_, i) => i)
    .filter(i => newHand.lineup[i].exitHand && !oldHand.lineup[i].exitHand)
);

export const lineupHasLeave = newHand => (
  newHand.lineup.some(seat => seat.exitHand <= newHand.handId)
);

export const isHandsComplete = (helper, oldHand, newHand) => {
  try {
    return [
      helper.isHandComplete(oldHand.lineup, oldHand.dealer, oldHand.state),
      helper.isHandComplete(newHand.lineup, newHand.dealer, newHand.state),
    ];
  } catch (e) {
    try {
      return [
        false,
        helper.isHandComplete(newHand.lineup, newHand.dealer, newHand.state),
      ];
    } catch (e2) {} // eslint-disable-line no-empty
  }

  return [false, false];
};
