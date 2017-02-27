var attr = require('dynamodb-data-types').AttributeValue;
var PokerHelper = require('poker-helper').PokerHelper;

const leaveReceived = function(oldHand, newHand) {
  for (var i = 0; i < newHand.lineup.length; i++) {
    if (newHand.lineup[i].lastHand !== undefined && 
      oldHand.lineup[i].lastHand === undefined) {
      // return after first leave detected
      // we don't expect more than one per db change
      return i;
    }
  }
  return -1;
}

const handTurnedComplete = function(oldHand, newHand) {
  const ph = new PokerHelper();
  if (ph.checkForNextHand(oldHand) === false && 
    ph.checkForNextHand(newHand) === true) {
    return true;
  }
  return false;
}

const lineupHasLeave = function(newHand) {
  for (var i = 0; i < newHand.lineup.length; i++) {
    if (newHand.lineup[i].lastHand === newHand.handId) {
      return i;
    }
  }
  return -1;
}


var StreamWorker = function(table) {
  this.table = table;
}

StreamWorker.prototype.process = function(record) {

  if (!record.eventName || record.eventName !== 'MODIFY') {
    return Promise.reject('unknown record type');
  }
  const newHand = attr.unwrap(record.dynamodb.NewImage);
  const oldHand = attr.unwrap(record.dynamodb.OldImage);
  const keys = attr.unwrap(record.dynamodb.Keys);

  // check leave
  var pos = leaveReceived(oldHand, newHand);
  if (pos > -1) {
    return this.table.leave(keys.tableAddr, newHand.lineup[pos].leaveReceipt);
  }

  // check hand complete and leaving player
  pos = lineupHasLeave(newHand);
  if (handTurnedComplete(oldHand, newHand) && pos > -1) {
      return Promise.resolve('now');
  }

  // nothing to do
  return Promise.resolve({});
}

module.exports = StreamWorker;