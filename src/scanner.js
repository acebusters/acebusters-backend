const P_EMPTY = '0x0000000000000000000000000000000000000000';

function ScanManager(factory, table, dynamo, sns, sentry, topicArn) {
  this.factory = factory;
  this.table = table;
  this.dynamo = dynamo;
  this.sns = sns;
  this.sentry = sentry;
  this.topicArn = topicArn;
}

ScanManager.prototype.scan = function scan() {
  return this.factory.getTables().then((set) => {
    if (!set || set.length === 0) {
      this.log('no contracts to scan');
    }
    const actions = [];
    set.forEach((tableAddr) => {
      actions.push(this.handleTable(tableAddr));
    });
    return Promise.all(actions);
  });
};

ScanManager.prototype.err = function err(e) {
  this.sentry.captureException(e, { server_name: 'interval-scanner' }, (sendErr) => {
    if (sendErr) {
      console.error(`Failed to send captured exception to Sentry: ${sendErr}`); // eslint-disable-line no-console
    }
  });
  return e;
};

ScanManager.prototype.log = function log(message, context) {
  const cntxt = (context) || {};
  cntxt.level = (cntxt.level) ? cntxt.level : 'info';
  cntxt.server_name = 'interval-scanner';
  return new Promise((fulfill, reject) => {
    const now = Math.floor(Date.now() / 1000);
    this.sentry.captureMessage(`${now} - ${message}`, cntxt, (error, eventId) => {
      if (error) {
        reject(error);
        return;
      }
      fulfill(eventId);
    });
  });
};

ScanManager.prototype.handleTable = function handleTable(tableAddr) {
  const lhnProm = this.table.getLastHandNetted(tableAddr);
  const lnrProm = this.table.getLNRHandId(tableAddr);
  const lntProm = this.table.getLNRTime(tableAddr);
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
          return this.notify({}, subject).then(() =>
            this.log(subject, { tags: { tableAddr }, extra: { lhn, lnr, lnt, now } }));
        }
        return null;
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
        }, subject).then(() => this.log(subject, {
          tags: { tableAddr },
          extra: { lhn, lnr, lnt, now },
        }));
      }

      return null;
    }

    // contract is netted up,
    // check if more netting can be done from oracle
    return Promise.all([
      this.dynamo.getLastHand(tableAddr),
      this.table.getLineup(tableAddr),
    ]);
  }).then((response) => {
    const results = [];
    if (!Array.isArray(response)) {
      return null;
    }

    const [lastHand, lineup] = response;
    if (!lastHand || !lastHand.handId) {
      return null;
    }

    // 1 hour
    const tooOld = Math.floor(Date.now() / 1000) - (60 * 60);
    if (lastHand.lineup) {
      // 5 minutes
      const old = Math.floor(Date.now() / 1000) - (5 * 60);
      const subject = `Kick::${tableAddr}`;
      let hasPlayer = false;
      for (let i = 0; i < lastHand.lineup.length; i += 1) {
        if (lastHand.lineup[i].sitout && typeof lastHand.lineup[i].sitout === 'number') {
          // check if any of the sitout flags are older than 5 min
          if (lastHand.lineup[i].sitout < old) {
            const seat = lastHand.lineup[i];
            results.push(this.notify({ pos: i, tableAddr }, subject).then(() =>
              this.log(subject, {
                tags: { tableAddr },
                user: { id: seat.address },
                extra: { sitout: seat.sitout },
              }),
            ));
          }
        }
        if (lastHand.lineup[i].address !== P_EMPTY) {
          hasPlayer = true;
        }
      }
      if (lastHand.changed > tooOld && hasPlayer) {
        results.push(this.notify({ tableAddr }, `Timeout::${tableAddr}`));
      }
    }

    const hasExitHands = lineup[3].some(exitHand => exitHand > 0);
    if (hasExitHands && lastHand.changed > tooOld) {
      // if some players trying to leave
      // prepare netting in db
      const subject = `TableNettingRequest::${tableAddr}`;
      results.push(this.notify({
        handId: lhn + 1,
        tableAddr,
      }, subject).then(() =>
        this.log(subject, { tags: { tableAddr }, extra: { lhn, handId: lastHand.handId } })),
      );
    }
    return Promise.all(results);
  });
};

ScanManager.prototype.notify = function notify(event, subject) {
  return new Promise((fulfill, reject) => {
    this.sns.publish({
      Message: JSON.stringify(event),
      Subject: subject,
      TopicArn: this.topicArn,
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
