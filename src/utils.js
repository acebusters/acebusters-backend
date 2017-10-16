// return after first leave detected
// we don't expect more than one per db change
export const leaveReceived = (oldHand, newHand) => (
  newHand.lineup.findIndex(
    (seat, i) => seat.exitHand && !oldHand.lineup[i].exitHand,
  )
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
