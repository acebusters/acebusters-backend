function Sdb(sdb, tableName) {
  this.sdb = sdb;
  this.domain = tableName;
}

Sdb.prototype.getContractSet = function(setId) {
  var self = this;
  return new Promise(function (fulfill, reject) {
    self.sdb.getAttributes({
      DomainName    : self.domain,
      ItemName      : setId
    }, function(err, data){
      if (err)
        reject('Error: ' + err.toString());
      else if (!data || !data.Attributes)
        reject('Error: entry ' + setId + ' not found.');
      else {
        var rv = {
          addresses: [],
          topicArn: '',
          contractAbi: [],
          lastBlock: 0
        };
        data.Attributes.forEach(function(aPair) {
          if (aPair.Name == 'lastBlock')
            rv.lastBlock = parseInt(aPair.Value);
          if (aPair.Name == 'topicArn')
            rv.topicArn = aPair.Value;
          if (aPair.Name == 'contractAbi')
            rv.contractAbi = aPair.Value;
          if (aPair.Name == 'addresses')
            rv.addresses.push(aPair.Value);
        });
        fulfill(rv);
      }
    });
  });
}

Sdb.prototype.updateBlockNumber = function(setId, blockNumber) {
  var self = this;
  return new Promise(function (fulfill, reject) {
    self.sdb.putAttributes({
      DomainName    : self.domain,
      ItemName      : setId,
      Attributes    : [{Name: 'lastBlock', Replace : true, Value: blockNumber.toString()}]
    }, function(err, data) {
      if (err)
        reject('Error: ' + err.toString);
      else
        fulfill(data);
    });
  });
}

module.exports = Sdb;