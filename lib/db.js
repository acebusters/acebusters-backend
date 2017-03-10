
function Db (dynamo) {
  this.dynamo = dynamo;
  this.tableName = 'poker';
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

Db.prototype.getHand = function(tableAddr, handId) {
  var self = this;
  return new Promise(function (fulfill, reject) {
    if (handId < 1) {
      fulfill({ handId: handId, state: 'showdown', distribution: '0x1234' }); //return the genensis hand
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

Db.prototype.updateLeave = function(tableAddr, handId, seat, pos) {
  var self = this;
  return new Promise(function (fulfill, reject) {
    var params = {
      TableName: self.tableName,
      Key:{
        tableAddr: tableAddr,
        handId: handId
      },
      UpdateExpression: 'set lineup['+pos+'] = :s',
      ExpressionAttributeValues: {
        ':s': seat
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

Db.prototype.updateSeat = function(tableAddr, handId, seat, pos, state, changed) {
  var self = this;
  return new Promise(function (fulfill, reject) {
    var params = {
      TableName: self.tableName,
      Key:{
        tableAddr: tableAddr,
        handId: handId
      },
      UpdateExpression: 'set lineup['+pos+'] = :l, #hand_state = :s, changed = :c',
      ExpressionAttributeValues: {
        ':l': seat,
        ':s': state,
        ':c': changed
      },
      ExpressionAttributeNames: {
        "#hand_state": "state"
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

Db.prototype.updateHandDist = function(tableAddr, handId, distribution, seat, pos) {
  var self = this;
  return new Promise(function (fulfill, reject) {
    var params = {
      TableName: self.tableName,
      Key:{
          tableAddr: tableAddr,
          handId: handId
      },
      UpdateExpression: 'set distribution = :d, lineup[' + pos + '] = :s',
      ExpressionAttributeValues: {
        ':s': seat,
        ':d': distribution
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

Db.prototype.updateNetting = function(tableAddr, handId, signer, nettingSig) {
  var self = this;
  return new Promise(function (fulfill, reject) {
    var params = {
      TableName: self.tableName,
      Key:{
          tableAddr: tableAddr,
          handId: handId
      },
      UpdateExpression: 'set netting['+signer+'] = :s',
      ExpressionAttributeValues: {
        ':s': nettingSig
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

module.exports = Db;