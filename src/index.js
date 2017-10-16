import { AttributeValue } from 'dynamodb-data-types';
import { PokerHelper } from 'poker-helper';
import { leaveReceived, lineupHasLeave, isHandsComplete } from './utils';

export default class StreamScanner {

  constructor(sns, topicArn, pusher, rc, logger) {
    this.sns = sns;
    this.topicArn = topicArn;
    this.pusher = pusher;
    this.rc = rc;
    this.logger = logger;
  }

  process(record) {
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
    const pos = leaveReceived(oldHand, newHand);
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
    const [oldHandComplete, newHandComplete] = isHandsComplete(ph, oldHand, newHand);
    if (newHandComplete && !oldHandComplete && newHand.state !== 'waiting') {
      tasks.push(this.notify(`HandComplete::${keys.tableAddr}`, {
        tableAddr: keys.tableAddr,
        handId: newHand.handId,
      }, this.topicArn));

      if (lineupHasLeave(newHand) && newHand.netting === undefined) {
        tasks.push(this.notify(`TableNettingRequest::${keys.tableAddr}`, {
          tableAddr: keys.tableAddr,
          handId: newHand.state === 'waiting' ? newHand.handId - 1 : newHand.handId,
        }, this.topicArn));
      }
    }

    // check netting complete
    if (newHand.lineup && oldHand.netting && newHand.netting) {
      const activePlayerCount = ph.countActivePlayers(newHand.lineup, newHand.state);
      // netting has X + 2 keys, where X is the number of active player submitted netting receipt
      // two other keys are "newBalances" and oracle signature
      const signedPlayersCount = Object.keys(newHand.netting).length - 2;
      const prevSignedPlayersCount = Object.keys(oldHand.netting).length - 2;
      if (signedPlayersCount > prevSignedPlayersCount && signedPlayersCount >= activePlayerCount) {
        // send settle tx with complete netting to table
        tasks.push(this.notify(`TableNettingComplete::${keys.tableAddr}`, {
          tableAddr: keys.tableAddr,
          handId: newHand.handId,
          netting: newHand.netting,
        }, this.topicArn));
      }
    }

    return Promise.all(tasks);
  }

  publishUpdate(topic, msg) {
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
  }

  notify(subject, event, topicArn) {
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
  }
}
