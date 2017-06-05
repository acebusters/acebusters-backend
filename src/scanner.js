const P_EMPTY = '0x0000000000000000000000000000000000000000';

function ScanManager(factory, table, dynamo, sns, sentry, request, topicArn) {
  this.factory = factory;
  this.table = table;
  this.dynamo = dynamo;
  this.sns = sns;
  this.sentry = sentry;
  this.request = request;
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

ScanManager.prototype.callTimeout = function callTimeout(tableAddr) {
  return new Promise((fulfill, reject) => {
    this.request.post({
      url: `https://evm4rumeob.execute-api.eu-west-1.amazonaws.com/v0/table/${tableAddr}/timeout`,
      json: true,
    }, (error, response) => {
      if (error) {
        reject(error);
        return;
      }
      fulfill(response);
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
        }, subject).then(() => this.log(subject, {
          tags: { tableAddr },
          extra: { lhn, lnr, lnt, now },
        }));
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
      return this.callTimeout(tableAddr);
    }
    // 1 hour
    const tooOld = Math.floor(Date.now() / 1000) - (60 * 60);
    if (rsp.lineup) {
      // 5 minutes
      const old = Math.floor(Date.now() / 1000) - (5 * 60);
      const subject = `Kick::${tableAddr}`;
      let hasPlayer = false;
      for (let i = 0; i < rsp.lineup.length; i += 1) {
        if (rsp.lineup[i].sitout && typeof rsp.lineup[i].sitout === 'number') {
          // check if any of the sitout flags are older than 5 min
          if (rsp.lineup[i].sitout < old) {
            const seat = rsp.lineup[i];
            results.push(this.notify({ pos: i, tableAddr }, subject).then(() =>
              this.log(subject, {
                tags: { tableAddr },
                user: { id: seat.address },
                extra: { sitout: seat.sitout },
              }),
            ));
          }
        }
        if (rsp.lineup[i].address !== P_EMPTY) {
          hasPlayer = true;
        }
      }
      if (rsp.changed > tooOld && hasPlayer) {
        results.push(this.callTimeout(tableAddr));
      }
    }
    if (rsp.handId >= lhn + 2 && rsp.changed > (tooOld)) {
      // if there are more than 2 hands not netted
      // prepare netting in db
      const subject = `TableNettingRequest::${tableAddr}`;
      results.push(this.notify({
        handId: rsp.handId - 1,
        tableAddr,
      }, subject).then(() =>
        this.log(subject, { tags: { tableAddr }, extra: { lhn, handId: rsp.handId } })),
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
