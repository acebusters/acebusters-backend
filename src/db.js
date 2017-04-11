
function Db(dynamo) {
  this.dynamo = dynamo;
  this.tableName = 'poker';
}

Db.prototype.getHand = function getHand(tableAddr, handId) {
  return new Promise((fulfill, reject) => {
    if (handId < 1) {
      fulfill({ distribution: {} }); // return the genensis hand
      return;
    }
    this.dynamo.getItem({
      TableName: this.tableName,
      Key: { tableAddr, handId },
    }, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      if (!data.Item) {
        reject(`Not Found: handId ${handId} not found.`);
        return;
      }
      fulfill(data.Item);
    });
  });
};

Db.prototype.getLastHand = function getLastHand(tableAddr) {
  return new Promise((fulfill, reject) => {
    this.dynamo.query({
      TableName: this.tableName,
      KeyConditionExpression: 'tableAddr = :a',
      ExpressionAttributeValues: { ':a': tableAddr },
      Limit: 1,
      ScanIndexForward: false,
    }, (err, rsp) => {
      if (err) {
        reject(err);
        return;
      }
      if (!rsp.Items || rsp.Items.length < 1) {
        reject(`Not Found: table with address ${tableAddr} unknown.`);
        return;
      }
      fulfill(rsp.Items[0]);
    });
  });
};

Db.prototype.getFirstHand = function getFirstHand(tableAddr) {
  return new Promise((fulfill, reject) => {
    this.dynamo.query({
      TableName: this.tableName,
      KeyConditionExpression: 'tableAddr = :a',
      ExpressionAttributeValues: { ':a': tableAddr },
      Limit: 1,
      ScanIndexForward: true,
    }, (err, rsp) => {
      if (err) {
        reject(err);
        return;
      }
      if (!rsp.Items || rsp.Items.length < 1) {
        reject(`Not Found: table with address ${tableAddr} unknown.`);
        return;
      }
      fulfill(rsp.Items[0]);
    });
  });
};

Db.prototype.updateSeat = function updateSeat(tableAddr, handId, seat, pos, time, dealer) {
  return new Promise((fulfill, reject) => {
    const params = {
      TableName: this.tableName,
      Key: { tableAddr, handId },
      UpdateExpression: `set lineup[${pos}] = :s, changed = :t, dealer = :d`,
      ExpressionAttributeValues: {
        ':s': seat,
        ':t': time,
        ':d': dealer,
      },
    };
    this.dynamo.updateItem(params, (err, rsp) => {
      if (err) {
        reject(err);
        return;
      }
      fulfill(rsp.Item);
    });
  });
};

Db.prototype.updateNetting = function updateNetting(tableAddr, handId, netting) {
  return new Promise((fulfill, reject) => {
    const params = {
      TableName: this.tableName,
      Key: { tableAddr, handId },
      UpdateExpression: 'set netting = :n',
      ExpressionAttributeValues: {
        ':n': netting,
      },
    };
    this.dynamo.updateItem(params, (err, rsp) => {
      if (err) {
        reject(err);
      }
      fulfill(rsp.Item);
    });
  });
};

Db.prototype.putHand = function putHand(tableAddr, handId, lineup, dealer, deck, sb, changed) {
  return new Promise((fulfill, reject) => {
    this.dynamo.putItem({
      TableName: this.tableName,
      Item: {
        tableAddr,
        handId,
        lineup,
        dealer,
        state: 'waiting',
        deck,
        sb,
        changed,
      },
    }, (err, data) => {
      if (err) {
        reject(`Error: Dynamo failed: ${err}`);
        return;
      }
      fulfill(data.Item);
    });
  });
};

Db.prototype.updateDistribution = function updateDistribution(tableAddr, handId, distribution) {
  return new Promise((fulfill, reject) => {
    const params = {
      TableName: this.tableName,
      Key: { tableAddr, handId },
      UpdateExpression: 'set distribution = :d',
      ExpressionAttributeValues: {
        ':d': distribution,
      },
    };
    this.dynamo.updateItem(params, (err, rsp) => {
      if (err) {
        reject(err);
        return;
      }
      fulfill(rsp.Item);
    });
  });
};

Db.prototype.deleteHand = function deleteHand(tableAddr, handId) {
  return new Promise((fulfill, reject) => {
    // avoid deleting unwanted entries
    if (!handId || !tableAddr) {
      reject('null key value detected on delete.');
    }
    this.dynamo.deleteItem({
      TableName: this.tableName,
      Key: { tableAddr, handId },
    }, (err, rsp) => {
      if (err) {
        reject(`Error: Dynamo failed: ${err}`);
        return;
      }
      fulfill(rsp);
    });
  });
};

module.exports = Db;
