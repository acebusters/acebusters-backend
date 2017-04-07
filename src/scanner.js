
function ScanManager(sdb, dynamo, contract, sns, sentry) {
  this.sdb = sdb;
  this.dynamo = dynamo;
  this.contract = contract;
  this.sns = sns;
  this.sentry = sentry;
}

ScanManager.prototype.scan = function scan(setId) {
  const actions = [];
  return this.sdb.getContractSet(setId).then((set) => {
    if (!set.addresses || set.addresses.length === 0) {
      this.log('no contracts to scan');
    }
    set.addresses.forEach((tableAddr) => {
      actions.push(this.handleTable(tableAddr, set.topicArn));
    });
    return Promise.all(actions);
  });
};

ScanManager.prototype.err = function err(e) {
  this.sentry.captureException(e, (sendErr) => {
    if (sendErr) {
      console.error(`Failed to send captured exception to Sentry: ${sendErr}`);
    }
  });
  return e;
};

ScanManager.prototype.log = function log(message, context) {
  const cntxt = (context) || {};
  cntxt.level = (cntxt.level) ? cntxt.level : 'info';
  return new Promise((fulfill, reject) => {
    this.sentry.captureMessage(message, cntxt, (error, eventId) => {
      if (error) {
        reject(error);
        return;
      }
      fulfill(eventId);
    });
  });
};

ScanManager.prototype.handleTable = function handleTable(tableAddr, topicArn) {
  const lhnProm = this.contract.getLastHandNetted(tableAddr);
  const lnrProm = this.contract.getLastNettingRequestHandId(tableAddr);
  const lntProm = this.contract.getLastNettingRequestTime(tableAddr);
  let lhn;
  let lnr;
  let lnt;
  return Promise.all([lhnProm, lnrProm, lntProm]).then((rsp) => {
    lhn = rsp[0];
    lnr = rsp[1];
    lnt = rsp[2];
    if (lnr > lhn) {
      const now = Math.floor(Date.now() / 1000);
      if (lnt + (60 * 10) < now) {
        if (lnt + (60 * 60) > now) {
          // if the dispute period is over
          // send transaction to net up in contract
          const subject = `ProgressNetting::${tableAddr}`;
          return this.notify({}, subject, topicArn).then(() => this.log(subject, { tags: { tableAddr }, extra: { lhn, lnr, lnt, now } }));
        }
        return Promise.resolve(null);
        // if dispute period is over since more than 1 hour,
        // do nothing
      }
      // don't react to netting requests younger than 3 minutes,
      // if it is older, and there is still time to sibmit receipt,
      // create event to submit dispute receipts.
      if (now > lnt + (60 * 3)) {
        const subject = `HandleDispute::${tableAddr}`;
        return this.notify({
          tableAddr,
          lastHandNetted: lhn,
          lastNettingRequest: lnr,
        }, subject, topicArn).then(() => this.log(subject, { tags: { tableAddr }, extra: { lhn, lnr, lnt, now } }));
      }
    } else {
      // contract is netted up,
      // check if more netting can be done from oracle
      return this.dynamo.getLastHand(tableAddr);
    }
    return Promise.resolve(null);
  }).then((rsp) => {
    const results = [];
    if (!rsp || !rsp.handId) {
      return Promise.resolve(rsp);
    }
    const tooOld = Math.floor(Date.now() / 1000) - (60 * 60);
    // check if any of the sitout flags are older than 5 min
    if (rsp.lineup) {
      // 5 minutes
      const old = Math.floor(Date.now() / 1000) - (5 * 60);
      // if the receipt is older than 1 hour, ignore it
      const subject = `Kick::${tableAddr}`;
      for (let i = 0; i < rsp.lineup.length; i += 1) {
        if (rsp.lineup[i].sitout && typeof rsp.lineup[i].sitout === 'number') {
          if (rsp.lineup[i].sitout < old && rsp.lineup[i].sitout > tooOld) {
            const seat = rsp.lineup[i];
            results.push(this.notify({ pos: i, tableAddr }, subject, topicArn).then(() => this.log(subject, {
              tags: { tableAddr },
              user: { id: seat.address },
              extra: { sitout: seat.sitout } })));
          }
        }
      }
    }
    if (rsp.handId >= lhn + 2 && rsp.changed > (tooOld)) {
      // if there are more than 2 hands not netted
      // prepare netting in db
      const subject = `TableNettingRequest::${tableAddr}`;
      results.push(this.notify({ handId: rsp.handId - 1, tableAddr }, subject, topicArn).then(() => this.log(subject, { tags: { tableAddr }, extra: { lhn, handId: rsp.handId } })));
    }
    return Promise.all(results);
  });
};

ScanManager.prototype.notify = function notify(event, subject, topicArn) {
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
      fulfill(subject);
    });
  });
};

module.exports = ScanManager;
