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

const renderPublicState = function(hand, rc) {
  if (hand.state == 'showdown') {
    for (var i = 0; i < hand.lineup.length; i++) {
      if (hand.lineup[i].last) {
        var last = rc.get(hand.lineup[i].last);
        if (last.abi[0].name == 'show') {
          hand.lineup[i].cards = [];
          hand.lineup[i].cards.push(hand.deck[i * 2]);
          hand.lineup[i].cards.push(hand.deck[i * 2 + 1]);
        }
      }
    }
  }
  var rv = {
    handId: hand.handId,
    lineup: hand.lineup,
    dealer: hand.dealer,
    state: hand.state,
    changed: hand.changed,
    cards: []
  }
  if (hand.state == 'flop') {
    rv.cards.push(hand.deck[20]);
    rv.cards.push(hand.deck[21]);
    rv.cards.push(hand.deck[22]);
  }
  if (hand.state == 'turn') {
    rv.cards.push(hand.deck[20]);
    rv.cards.push(hand.deck[21]);
    rv.cards.push(hand.deck[22]);
    rv.cards.push(hand.deck[23]);
  }
  if (hand.state == 'river' || hand.state == 'showdown') {
    rv.cards.push(hand.deck[20]);
    rv.cards.push(hand.deck[21]);
    rv.cards.push(hand.deck[22]);
    rv.cards.push(hand.deck[23]);
    rv.cards.push(hand.deck[24]);
  }
  if (hand.distribution) {
    rv.distribution = hand.distribution;
  }
  if (hand.netting) {
    rv.netting = hand.netting;
  }
  return rv;
}

var StreamScanner = function(sns, topicArn, pusher, rc) {
  this.sns = sns;
  this.topicArn = topicArn;
  this.pusher = pusher;
  this.rc = rc;
}

StreamScanner.prototype.process = function(record) {
  if (!record || !record.dynamodb ||
    (record.eventName !== 'MODIFY' && record.eventName !== 'INSERT')) {
    return Promise.reject('unknown record type: ' + JSON.stringify(record));
  }
  const tasks = [];
  const newHand = attr.unwrap(record.dynamodb.NewImage);
  const keys = attr.unwrap(record.dynamodb.Keys);

  // check update
  const msg = renderPublicState(newHand, this.rc);
  tasks.push(this.publishUpdate(keys.tableAddr, msg));

  if (record.eventName === 'INSERT') {
    return Promise.all(tasks);
  }

  const oldHand = attr.unwrap(record.dynamodb.OldImage);

  // check leave
  var pos = leaveReceived(oldHand, newHand);
  if (pos > -1) {

    // send leave receipt to contract
    tasks.push(this.notify('TableLeave::' + keys.tableAddr, {
      leaveReceipt: newHand.lineup[pos].leaveReceipt,
      tableAddr: keys.tableAddr
    }, this.topicArn));
  }

  // check hand complete
  const ph = new PokerHelper();
  if (ph.checkForNextHand(newHand) === true &&
    newHand.distribution !== undefined) {
    tasks.push(this.notify('HandComplete::'+keys.tableAddr, {
      tableAddr: keys.tableAddr,
      handId: newHand.handId
    }, this.topicArn));
    pos = lineupHasLeave(newHand);
    if (pos > -1 && newHand.netting === undefined) {
      tasks.push(this.notify('TableNettingRequest::'+keys.tableAddr, {
        tableAddr: keys.tableAddr,
        handId: newHand.handId
      }, this.topicArn));
    }
  }

  // check netting complete
  if (newHand.lineup !== undefined &&
    oldHand.netting !== undefined &&
    newHand.netting !== undefined &&
    Object.keys(newHand.netting).length > Object.keys(oldHand.netting).length &&
    Object.keys(newHand.netting).length >= newHand.lineup.length) {

    // send settle tx with complete netting to table
    tasks.push(this.notify('TableNettingComplete::'+keys.tableAddr, {
      tableAddr: keys.tableAddr,
      handId: newHand.handId,
      netting: newHand.netting
    }, this.topicArn));
  }

  return Promise.all(tasks);
}

StreamScanner.prototype.publishUpdate = function(topic, msg) {
  const self = this;
  return new Promise(function (fulfill, reject) {
    try {
      const rsp = self.pusher.trigger(topic, 'update', msg);
      fulfill(rsp);
    } catch (err) {
      reject(err);
    }
  });
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