
function Db (dynamo) {
  this.dynamo = dynamo;
  this.tableName = 'poker';
}

Db.prototype.getHand = function(tableAddr, handId) {
  var self = this;
  return new Promise(function (fulfill, reject) {
    if (handId < 1) {
      fulfill({distribution: {}}); //return the genensis hand
      return;
    }
    self.dynamo.getItem({
      TableName: self.tableName,
      Key: {
        tableAddr: tableAddr,
        handId: handId
      }
    }, function(err, data){
      if (err) {
        reject(err);
        return;
      }
      if(!data.Item) {
        reject('Not Found: handId ' + handId + ' not found.');
        return;
      }
      fulfill(data.Item);
    });
  });
}

Db.prototype.updateNetting = function(tableAddr, handId, netting) {
  var self = this;
  return new Promise(function (fulfill, reject) {
    var params = {
      TableName: self.tableName,
      Key:{
        tableAddr: tableAddr,
        handId: handId
      },
      UpdateExpression: 'set netting = :n',
      ExpressionAttributeValues: {
        ':n': netting
      }
    };
    self.dynamo.updateItem(params, function(err, rsp) {
      if (err) {
        reject(err);
      }
      fulfill(rsp.Item);
    });
  });
}



module.exports = Db;
