const attr = require('dynamodb-data-types').AttributeValue;
const PokerHelper = require('poker-helper').PokerHelper;

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

const lineupHasLeave = function(newHand) {
  for (var i = 0; i < newHand.lineup.length; i++) {
    if (newHand.lineup[i].lastHand === newHand.handId) {
      return i;
    }
  }
  return -1;
}

var StreamScanner = function(sns, topicArn) {
  this.sns = sns;
  this.topicArn = topicArn;
}

StreamScanner.prototype.process = function(record) {

  if (!record.eventName || record.eventName !== 'MODIFY') {
    return Promise.reject('unknown record type');
  }
  const newHand = attr.unwrap(record.dynamodb.NewImage);
  const oldHand = attr.unwrap(record.dynamodb.OldImage);
  const keys = attr.unwrap(record.dynamodb.Keys);

  // check leave
  var pos = leaveReceived(oldHand, newHand);
  if (pos > -1) {

    // send leave receipt to contract
    return this.notify('TableLeave::' + keys.tableAddr, {
      leaveReceipt: newHand.lineup[pos].leaveReceipt,
      tableAddr: keys.tableAddr
    }, this.topicArn);
  }

  // check hand complete
  const ph = new PokerHelper(), self = this;
  if (ph.checkForNextHand(newHand) === true &&
    newHand.distribution !== undefined) {
    return this.notify('HandComplete::'+keys.tableAddr, {
      tableAddr: keys.tableAddr,
      handId: newHand.handId
    }, this.topicArn).then(function() {
      // and leaving player
      pos = lineupHasLeave(newHand);
      if (pos > -1 && 
        newHand.netting === undefined) {
        return self.notify('TableNettingRequest::'+keys.tableAddr, {
          tableAddr: keys.tableAddr,
          handId: newHand.handId
        }, self.topicArn);
      }
    });
  }

  // check netting complete
  if (newHand.lineup !== undefined &&
    oldHand.netting !== undefined &&
    newHand.netting !== undefined &&
    Object.keys(newHand.netting).length > Object.keys(oldHand.netting).length &&
    Object.keys(newHand.netting).length >= newHand.lineup.length) {

    // send settle tx with complete netting to table
    return this.notify('TableNettingComplete::'+keys.tableAddr, {
      tableAddr: keys.tableAddr,
      handId: newHand.handId,
      netting: newHand.netting
    }, this.topicArn);
  }

  // nothing to do
  return Promise.resolve({});
}

StreamScanner.prototype.notify = function(subject, event, topicArn) {
  const self = this;
  return new Promise(function (fulfill, reject) {
    self.sns.publish({
      Message: JSON.stringify(event),
      Subject: subject,
      TopicArn: topicArn
    }, function(err, rsp){
      if (err) {
        reject(err);
        return;
      }
      console.log('published event: ' + subject);
      fulfill({});
    });
  });
}

module.exports = StreamScanner;