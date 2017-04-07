function Sdb(sdb, tableName) {
  this.sdb = sdb;
  this.domain = tableName;
}

Sdb.prototype.getContractSet = function getContractSet(setId) {
  const self = this;
  return new Promise((fulfill, reject) => {
    self.sdb.getAttributes({
      DomainName: self.domain,
      ItemName: setId,
    }, (err, data) => {
      if (err) { reject(`Error: ${err.toString()}`); } else if (!data || !data.Attributes) { reject(`Error: entry ${setId} not found.`); } else {
        const rv = {
          addresses: [],
          topicArn: '',
          contractAbi: [],
          lastBlock: 0,
        };
        data.Attributes.forEach((aPair) => {
          if (aPair.Name === 'lastBlock') { rv.lastBlock = parseInt(aPair.Value, 10); }
          if (aPair.Name === 'topicArn') { rv.topicArn = aPair.Value; }
          if (aPair.Name === 'contractAbi') { rv.contractAbi = aPair.Value; }
          if (aPair.Name === 'addresses') { rv.addresses.push(aPair.Value); }
        });
        fulfill(rv);
      }
    });
  });
};

Sdb.prototype.updateBlockNumber = function updateBlockNumber(setId, blockNumber) {
  const self = this;
  return new Promise((fulfill, reject) => {
    self.sdb.putAttributes({
      DomainName: self.domain,
      ItemName: setId,
      Attributes: [{ Name: 'lastBlock', Replace: true, Value: blockNumber.toString() }],
    }, (err, data) => {
      if (err) { reject(`Error: ${err.toString}`); } else { fulfill(data); }
    });
  });
};

module.exports = Sdb;
