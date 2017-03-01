
function ScanManager(db, contract, sns) {
  this.db = db;
  this.contract = contract;
  this.sns = sns;
}

ScanManager.prototype.scan = function(setId) {
  var self = this, set, blockNumber;
  return this.db.getContractSet(setId).then(function(_set) {
    set = _set;
    if (!set.addresses || set.addresses.length == 0)
      return Promise.reject('no contracts to scan');
    return self.contract.getBlockNumber();
  }).then(function(_blockNumber) {
    var actions = [];
    blockNumber = _blockNumber;
    if (blockNumber <= set.lastBlock) {
      return Promise.reject('no new blocks');
    }
    set.addresses.forEach(function(addr) {
      actions.push(self.contract.filterContract(set.lastBlock, blockNumber, JSON.parse(set.contractAbi), addr));
    });
    return Promise.all(actions);
  }).then(function(events) {
    var all = [];
    events.forEach(function(event) {
      all = all.concat(event);
    });
    var dispatches = [];
    all.forEach(function(event) {
      if (event) {
        var subj = 'ContractEvent::'+ event.address;
        dispatches.push(self.notify(event, subj, set.topicArn));
      }
    });
    return Promise.all(dispatches);
  }).then(function() {
    return self.db.updateBlockNumber(setId, blockNumber);
  }).catch(function(err) {
    if (err == 'no new blocks' || err == 'no contracts to scan')
      return Promise.resolve({status: err});
    else
      return Promise.reject(err);
  });
}

ScanManager.prototype.notify = function(event, subject, topicArn) {
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

module.exports = ScanManager;