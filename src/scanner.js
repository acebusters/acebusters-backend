const P_EMPTY = '0x0000000000000000000000000000000000000000';

class ScanManager {
  constructor(factory, table, dynamo, sns, logger, topicArn, web3, cloudwatch, sdb) {
    this.factory = factory;
    this.table = table;
    this.dynamo = dynamo;
    this.sns = sns;
    this.logger = logger;
    this.topicArn = topicArn;
    this.web3 = web3;
    this.cloudwatch = cloudwatch;
    this.sdb = sdb;
  }

  async scan(wallets) {
    const tables = await this.factory.getTables();
    if (!tables || tables.length === 0) {
      this.logger.log('no contracts to scan');
    }

    const promises = tables.map(this.handleTable.bind(this));
    // check proxy pool
    if (this.sdb) {
      promises.push(this.checkPool());
    }
    // check wallet balances
    if (wallets) {
      promises.push(wallets.map(this.checkBalance.bind(this)));
    }
    return Promise.all(promises);
  }

  checkPool() {
    return new Promise((resolve, reject) => {
      this.sdb.getAvailableProxiesCount().then((proxiesCount) => {
        const metric = {
          MetricData: [{
            MetricName: this.sdb.getTableName(),
            Dimensions: [{ Name: 'Proxies', Value: 'Count' }],
            Timestamp: new Date(),
            Unit: 'Count',
            Value: proxiesCount,
          }],
          Namespace: 'Acebusters',
        };
        this.cloudwatch.putMetricData(metric, (error, data) => {
          if (error) {
            return reject(error);
          }
          return resolve(data);
        });
      });
    });
  }

  async checkBalance(walletAddr) {
    this.web3.eth.getBalance(walletAddr, (err, wei) => {
      if (err) {
        this.logger.log('balanceError', { tags: { walletAddr }, extra: err });
      } else {
        const metric = {
          MetricData: [{
            MetricName: walletAddr,
            Dimensions: [{ Name: 'Wallet Balance', Value: 'Ether' }],
            Timestamp: new Date(),
            Unit: 'Count',
            Value: this.web3.fromWei(wei, 'ether').toNumber(),
          }],
          Namespace: 'Acebusters',
        };
        this.cloudwatch.putMetricData(metric, (error, data) => {
          if (err) {
            this.logger.log('metricError', { tags: { walletAddr }, extra: error });
            return error;
          }
          return data;
        });
      }
    });
  }

  async handleTable(tableAddr) {
    const [lhn, lnr, lnt] = await Promise.all([
      this.table.getLastHandNetted(tableAddr),
      this.table.getLNRHandId(tableAddr),
      this.table.getLNRTime(tableAddr),
    ]);

    if (lnr > lhn) {
      const now = Math.floor(Date.now() / 1000);
      if (lnt + (60 * 10) < now) {
        if (lnt + (60 * 60) > now) {
          // if the dispute period is over
          // send transaction to net up in contract
          const subject = `ProgressNetting::${tableAddr}`;
          return this.notify({}, subject).then(() =>
            this.logger.log(subject, { tags: { tableAddr }, extra: { lhn, lnr, lnt, now } }));
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
        }, subject).then(() => this.logger.log(subject, {
          tags: { tableAddr },
          extra: { lhn, lnr, lnt, now },
        }));
      }

      return null;
    }

    // contract is netted up,
    // check if more netting can be done from oracle
    const lastHand = await this.dynamo.getLastHand(tableAddr);

    if (!lastHand || !lastHand.handId) {
      return null;
    }

    const results = [];
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
              this.logger.log(subject, {
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
      // last hand played an hour ago and the table still has players -> timeout the table
      if (lastHand.changed < tooOld && hasPlayer) {
        results.push(this.notify({ tableAddr }, `Timeout::${tableAddr}`));
      }
    }

    if (lastHand.handId >= lhn + 10) {
      // if there are more than 10 hands not netted
      // prepare netting in db
      const subject = `TableNettingRequest::${tableAddr}`;
      results.push(this.notify({
        handId: lastHand.handId - 1,
        tableAddr,
      }, subject).then(() =>
        this.log(subject, { tags: { tableAddr }, extra: { lhn, handId: lastHand.handId } })),
      );
    }

    return Promise.all(results);
  }

  notify(event, subject) {
    return new Promise((resolve, reject) => {
      this.sns.publish({
        Message: JSON.stringify(event),
        Subject: subject,
        TopicArn: this.topicArn,
      }, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(subject);
      });
    });
  }
}

module.exports = ScanManager;
