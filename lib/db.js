
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

Db.prototype.getLastHand = function(tableAddr) {
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

Db.prototype.updateSeat = function(tableAddr, handId, seat, pos, time) {
  var self = this;
  return new Promise(function (fulfill, reject) {
    var params = {
      TableName: self.tableName,
      Key:{
        tableAddr: tableAddr,
        handId: handId
      },
      UpdateExpression: 'set lineup['+pos+'] = :s, changed = :t',
      ExpressionAttributeValues: {
        ':s': seat,
        ':t': time
      }
    };
    self.dynamo.updateItem(params, function(err, rsp) {
      if (err) {
        reject(err);
        return;
      }
      fulfill(rsp.Item);
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

Db.prototype.putHand = function(tableAddr, handId, lineup, dealer, deck, changed) {
  var self = this;
  return new Promise(function (fulfill, reject) {

    self.dynamo.putItem({
      TableName: self.tableName,
      Item: {
        tableAddr: tableAddr,
        handId: handId, 
        lineup: lineup,
        dealer: dealer,
        state: 'waiting',
        deck: deck,
        changed: changed
      }
    }, function(err, data) {
      if (err) {
        reject('Error: Dynamo failed: ' + err);
        return;
      }
      fulfill(data.Item);
    });
  });
}

module.exports = Db;
