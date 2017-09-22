import { AttributeValue } from 'dynamodb-data-types';
import { PokerHelper } from 'poker-helper';

const leaveReceived = function leaveReceived(oldHand, newHand) {
  for (let i = 0; i < newHand.lineup.length; i += 1) {
    if (newHand.lineup[i].exitHand !== undefined &&
      oldHand.lineup[i].exitHand === undefined) {
      // return after first leave detected
      // we don't expect more than one per db change
      return i;
    }
  }
  return -1;
};

const lineupHasLeave = function lineupHasLeave(newHand) {
  for (let i = 0; i < newHand.lineup.length; i += 1) {
    if (newHand.lineup[i].exitHand <= newHand.handId) {
      return i;
    }
  }
  return -1;
};

const StreamScanner = function StreamScanner(sns, topicArn, pusher, rc, logger) {
  this.sns = sns;
  this.topicArn = topicArn;
  this.pusher = pusher;
  this.rc = rc;
  this.logger = logger;
};

StreamScanner.prototype.process = function process(record) {
  if (!record || !record.dynamodb ||
    (record.eventName !== 'MODIFY' && record.eventName !== 'INSERT')) {
    return Promise.resolve(`unknown record type: ${JSON.stringify(record)}`);
  }
  const tasks = [];
  const newHand = AttributeValue.unwrap(record.dynamodb.NewImage);
  const keys = AttributeValue.unwrap(record.dynamodb.Keys);

  // check update
  const ph = new PokerHelper(this.rc);
  // .renderHand(
  const msg = ph.renderHand(newHand.handId, newHand.lineup, newHand.dealer,
    newHand.sb, newHand.state, newHand.changed, newHand.deck, newHand.preMaxBet,
    newHand.flopMaxBet, newHand.turnMaxBet, newHand.riverMaxBet,
    newHand.distribution, newHand.netting);
  tasks.push(this.publishUpdate(keys.tableAddr, msg));


  if (record.eventName === 'INSERT') {
    return Promise.all(tasks);
  }

  const oldHand = AttributeValue.unwrap(record.dynamodb.OldImage);

  // check leave
  let pos = leaveReceived(oldHand, newHand);
  if (pos > -1) {
    // send leave receipt to contract
    tasks.push(this.notify(`TableLeave::${keys.tableAddr}`, {
      leaverAddr: newHand.lineup[pos].address,
      tableAddr: keys.tableAddr,
      exitHand: newHand.lineup[pos].exitHand,
    }, this.topicArn));
    // also, if the leave is for last hand, we can create a distribution already
    if (newHand.lineup[pos].exitHand < newHand.handId) {
      tasks.push(this.notify(`TableNettingRequest::${keys.tableAddr}`, {
        tableAddr: keys.tableAddr,
        handId: newHand.lineup[pos].exitHand,
      }, this.topicArn));
    }
  }

  // check hand complete
  let newHandComplete = false;
  let oldHandComplete = false;
  try {
    oldHandComplete = ph.isHandComplete(oldHand.lineup, oldHand.dealer, oldHand.state);
    newHandComplete = ph.isHandComplete(newHand.lineup, newHand.dealer, newHand.state);
  } catch (err1) {
    try {
      newHandComplete = ph.isHandComplete(newHand.lineup, newHand.dealer, newHand.state);
    } catch (err2) {
      // give up
    }
  }
  if (newHandComplete === true && oldHandComplete === false && newHand.state !== 'waiting') {
    tasks.push(this.notify(`HandComplete::${keys.tableAddr}`, {
      tableAddr: keys.tableAddr,
      handId: newHand.handId,
    }, this.topicArn));
    pos = lineupHasLeave(newHand);
    if (pos > -1 && newHand.netting === undefined) {
      const handId = newHand.state === 'waiting' ? newHand.handId - 1 : newHand.handId;
      tasks.push(this.notify(`TableNettingRequest::${keys.tableAddr}`, {
        tableAddr: keys.tableAddr,
        handId,
      }, this.topicArn));
    }
  }

  // check netting complete
  if (newHand.lineup !== undefined && oldHand.netting !== undefined &&
    newHand.netting !== undefined) {
    const taken = ph.countActivePlayers(newHand.lineup, newHand.state);
    const sigCount = Object.keys(newHand.netting).length;
    if (sigCount > Object.keys(oldHand.netting).length && sigCount - 2 >= taken) {
      // send settle tx with complete netting to table
      tasks.push(this.notify(`TableNettingComplete::${keys.tableAddr}`, {
        tableAddr: keys.tableAddr,
        handId: newHand.handId,
        netting: newHand.netting,
      }, this.topicArn));
    }
  }
  return Promise.all(tasks);
};

StreamScanner.prototype.publishUpdate = function publishUpdate(topic, msg) {
  return new Promise((fulfill, reject) => {
    try {
      const rsp = this.pusher.trigger(topic, 'update', {
        type: 'handUpdate',
        payload: msg,
      });
      fulfill(rsp);
    } catch (err) {
      reject(err);
    }
  });
};

StreamScanner.prototype.notify = function notify(subject, event, topicArn) {
  return new Promise((fulfill, reject) => {
    this.sns.publish({
      Message: JSON.stringify(event),
      Subject: subject,
      TopicArn: topicArn,
    }, (err) => {
      if (err) {
        reject(err);
        return;
      }
      fulfill({});
    });
  });
};

module.exports = StreamScanner;
