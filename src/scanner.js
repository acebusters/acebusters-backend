
function ScanManager(db, table, sns, factory, topicArn) {
  this.db = db;
  this.factory = factory;
  this.table = table;
  this.sns = sns;
  this.topicArn = topicArn;
}

ScanManager.prototype.scan = function scan(setId) {
  const dbProm = this.db.getContractSet(setId);
  const tfProm = this.factory.getTables();
  let set;
  let lastBlock;
  let blockNumber;
  return Promise.all([dbProm, tfProm]).then((rsp) => {
    lastBlock = rsp[0].lastBlock;
    set = rsp[1];
    if (!set || set.length === 0) {
      return Promise.reject('no contracts to scan');
    }
    return this.table.getBlockNumber();
  }).then((_blockNumber) => {
    const actions = [];
    blockNumber = _blockNumber;
    if (blockNumber <= lastBlock) {
      return Promise.reject('no new blocks');
    }
    set.forEach((addr) => {
      actions.push(this.table.filterContract(lastBlock,
        blockNumber, addr));
    });
    return Promise.all(actions);
  }).then((events) => {
    let all = [];
    events.forEach((event) => {
      all = all.concat(event);
    });
    const dispatches = [];
    all.forEach((event) => {
      if (event) {
        const subj = `ContractEvent::${event.address}`;
        dispatches.push(this.notify(event, subj));
      }
    });
    return Promise.all(dispatches);
  })
  .then(() => this.db.updateBlockNumber(setId, blockNumber))
  .catch((err) => {
    if (err === 'no new blocks' || err === 'no contracts to scan') {
      return Promise.resolve({ status: err });
    }
    return Promise.reject(err);
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
      fulfill({});
    });
  });
};

module.exports = ScanManager;
