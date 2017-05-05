function Db(sdb, tableName) {
  this.sdb = sdb;
  this.domain = tableName;
}

Db.prototype.getContractSet = function getContractSet(setId) {
  return new Promise((fulfill, reject) => {
    this.sdb.getAttributes({
      DomainName: this.domain,
      ItemName: setId,
    }, (err, data) => {
      if (err) {
        reject(`Error: ${err.toString()}`);
        return;
      }
      if (!data || !data.Attributes) {
        reject(`Error: entry ${setId} not found.`);
        return;
      }
      const rv = {
        addresses: [],
        topicArn: '',
        contractAbi: [],
        lastBlock: 0,
      };
      data.Attributes.forEach((aPair) => {
        if (aPair.Name === 'lastBlock') {
          rv.lastBlock = parseInt(aPair.Value, 10);
        }
        if (aPair.Name === 'topicArn') {
          rv.topicArn = aPair.Value;
        }
        if (aPair.Name === 'contractAbi') {
          rv.contractAbi = aPair.Value;
        }
        if (aPair.Name === 'addresses') {
          rv.addresses.push(aPair.Value);
        }
      });
      fulfill(rv);
    });
  });
};

Db.prototype.updateBlockNumber = function updateBlockNumber(setId, blockNumber) {
  return new Promise((fulfill, reject) => {
    this.sdb.putAttributes({
      DomainName: this.domain,
      ItemName: setId,
      Attributes: [{
        Name: 'lastBlock',
        Replace: true,
        Value: blockNumber.toString(),
      }],
    }, (err, data) => {
      if (err) {
        reject(`Error: ${err.toString}`);
        return;
      }
      fulfill(data);
    });
  });
};

module.exports = Db;
