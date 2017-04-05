function Dynamo (dynamo) {
  this.dynamo = dynamo;
  this.tableName = 'poker';
}


Dynamo.prototype.getLastHand = function(tableAddr) {
  var self = this;
  return new Promise(function (fulfill, reject) {
    self.dynamo.query({
      TableName: self.tableName,
      KeyConditionExpression: 'tableAddr = :a',
      ExpressionAttributeValues: {':a': tableAddr},
      Limit: 1,
      ScanIndexForward: false
    }, function(err, rsp) {
      if (err) {
        reject(err);
        return;
      }
      if (!rsp.Items || rsp.Items.length < 1) {
        reject('Not Found: table with address ' + tableAddr + ' unknown.');
        return;
      }
      fulfill(rsp.Items[0]);
    });
  });
}

module.exports = Dynamo;