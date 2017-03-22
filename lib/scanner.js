
function ScanManager(sdb, dynamo, contract, sns) {
  this.sdb = sdb;
  this.dynamo = dynamo;
  this.contract = contract;
  this.sns = sns;
}

ScanManager.prototype.scan = function(setId) {
  const self = this;
  const actions = [];
  return this.sdb.getContractSet(setId).then(function(set) {
    if (!set.addresses || set.addresses.length == 0)
      return Promise.reject('no contracts to scan');
    set.addresses.forEach(function(tableAddr) {
      actions.push(self.handleTable(tableAddr, set.topicArn));
    });
    return Promise.all(actions);
  })
}

ScanManager.prototype.handleTable = function(tableAddr, topicArn) {
  const self = this;
  const lhnProm = this.contract.getLastHandNetted(tableAddr);
  const lnrProm = this.contract.getLastNettingRequestHandId(tableAddr);
  const lntProm = this.contract.getLastNettingRequestTime(tableAddr);
  var lhn, lnr, lnt;
  return Promise.all([lhnProm, lnrProm, lntProm]).then(function(rsp) {
    lhn = rsp[0];
    lnr = rsp[1];
    lnt = rsp[2];
    if (lnr > lhn) {
      const now = Math.floor(Date.now() / 1000);
      if (lnt + 60 * 10 < now) {
        // if the dispute period is over
        // send transaction to net up in contract
        return self.notify({}, 'ProgressNetting::' + tableAddr, topicArn);
      } else {
        // don't react to netting requests younger than 3 minutes,
        // if it is older, and there is still time to sibmit receipt,
        // create event to submit dispute receipts.
        if (now > lnt + 60 * 3) {
          return self.notify({
            tableAddr: tableAddr,
            lastHandNetted: lhn,
            lastNettingRequest: lnr
          },'HandleDispute::' + tableAddr, topicArn);
        }
      }
    }
    if (lhn == lnr) {
      // contract is netted up,
      // check if more netting can be done from oracle
      return self.dynamo.getLastHand(tableAddr);
    } else {
      return Promise.resolve('nothing to do');
    }
  }).then(function(rsp) {
    if (!rsp || !rsp.handId) {
      return Promise.resolve(rsp);
    }
    if (rsp.handId > lhn + 1) {
      return self.notify({handId: rsp.handId}, 'ProgressNettingRequest::' + tableAddr, topicArn);
    } else {
      return Promise.resolve('nothing to do');
    }
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
      fulfill(subject);
    });
  });
}

module.exports = ScanManager;