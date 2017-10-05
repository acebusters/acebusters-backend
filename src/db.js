import { NotFound } from './errors';

function Db(dynamo, tableName) {
  this.dynamo = dynamo;
  this.tableName = (typeof tableName === 'undefined') ? 'sb_cashgame' : tableName;
}

Db.prototype.updateItem = function updateItem(params) {
  return new Promise((fulfill, reject) => {
    this.dynamo.updateItem(params, (err, rsp) => {
      if (err) {
        return reject(err);
      }
      return fulfill(rsp.Item);
    });
  });
};

Db.prototype.getTableHands = function getTableHands(tableAddr) {
  return new Promise((fulfill, reject) => {
    this.dynamo.query({
      TableName: this.tableName,
      KeyConditionExpression: 'tableAddr = :a',
      ExpressionAttributeValues: { ':a': tableAddr },
      ScanIndexForward: false,
    }, (err, rsp) => {
      if (err) {
        return reject(err);
      }
      if (!rsp.Items || rsp.Items.length < 1) {
        return reject(new NotFound(`table with address ${tableAddr} unknown.`));
      }
      return fulfill(rsp.Items);
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
        return reject(err);
      }
      if (!rsp.Items || rsp.Items.length < 1) {
        return reject(new NotFound(`table with address ${tableAddr} unknown.`));
      }
      return fulfill(rsp.Items[0]);
    });
  });
};

Db.prototype.getHand = function getHand(tableAddr, handId) {
  return new Promise((fulfill, reject) => {
    if (handId < 1) {
      // return the genensis hand
      fulfill({ handId, state: 'showdown', distribution: '0x1234' });
    } else {
      this.dynamo.getItem({
        TableName: this.tableName,
        Key: { tableAddr, handId },
      }, (err, data) => {
        if (err) {
          return reject(err);
        }
        if (!data.Item) {
          return reject(new NotFound(`handId ${handId} not found.`));
        }
        return fulfill(data.Item);
      });
    }
  });
};

Db.prototype.updateLeave = function updateLeave(tableAddr, handId, pos, exitHand, sitout, changed) {
  const params = {
    TableName: this.tableName,
    Key: { tableAddr, handId },
    UpdateExpression: `set lineup[${pos}].#exitHand = :eh, changed = :c`,
    ExpressionAttributeNames: {
      '#exitHand': 'exitHand',
    },
    ExpressionAttributeValues: {
      ':eh': exitHand,
      ':c': changed,
    },
  };

  if (sitout) {
    params.UpdateExpression += `, lineup[${pos}].#sitout = :so`;
    params.ExpressionAttributeNames['#sitout'] = 'sitout';
    params.ExpressionAttributeValues[':so'] = sitout;
  }

  return this.updateItem(params);
};

Db.prototype.updateSeat = function updateSeat(tableAddr,
  handId, seat, pos, state, changed, streetMaxBet) {
  const params = {
    TableName: this.tableName,
    Key: { tableAddr, handId },
    UpdateExpression: `set lineup[${pos}] = :l, #hand_state = :s, changed = :c`,
    ExpressionAttributeValues: {
      ':l': seat,
      ':s': state,
      ':c': changed,
    },
    ExpressionAttributeNames: {
      '#hand_state': 'state',
    },
  };
  if (streetMaxBet && streetMaxBet > 0) {
    let attribute = 'preMaxBet';
    if (state === 'showdown') {
      attribute = 'riverMaxBet';
    }
    if (state === 'river') {
      attribute = 'turnMaxBet';
    }
    if (state === 'turn') {
      attribute = 'flopMaxBet';
    }
    params.UpdateExpression += `, ${attribute} = :m`;
    params.ExpressionAttributeValues[':m'] = streetMaxBet;
  }
  return this.updateItem(params);
};

Db.prototype.updateNetting = function updateNetting(tableAddr, handId, signer, nettingSig) {
  const params = {
    TableName: this.tableName,
    Key: { tableAddr, handId },
    UpdateExpression: 'set netting.#signer = :s',
    ExpressionAttributeNames: {
      '#signer': signer,
    },
    ExpressionAttributeValues: {
      ':s': nettingSig,
    },
    ReturnValues: 'ALL_NEW',
  };
  return this.updateItem(params);
};

Db.prototype.setSeat = function setSeat(tableAddr, handId, pos, changed, addr, sitout) {
  const params = {
    TableName: this.tableName,
    Key: { tableAddr, handId },
    UpdateExpression: `set lineup[${pos}].#address = :a, changed = :c`,
    ExpressionAttributeNames: {
      '#address': 'address',
    },
    ExpressionAttributeValues: {
      ':a': addr,
      ':c': changed,
    },
  };
  if (sitout) {
    params.UpdateExpression += `, lineup[${pos}].#sitout = :so`;
    params.ExpressionAttributeNames['#sitout'] = 'sitout';
    params.ExpressionAttributeValues[':so'] = sitout;
  }
  return this.updateItem(params);
};

Db.prototype.emptySeat = function emptySeat(tableAddr, handId, pos, changed) {
  const params = {
    TableName: this.tableName,
    Key: { tableAddr, handId },
    UpdateExpression: `set lineup[${pos}] = :s, changed = :c`,
    ExpressionAttributeValues: {
      ':s': { address: '0x0000000000000000000000000000000000000000' },
      ':c': changed,
    },
  };
  return this.updateItem(params);
};


Db.prototype.setDealer = function setDealer(tableAddr, handId, changed, dealer) {
  const params = {
    TableName: this.tableName,
    Key: { tableAddr, handId },
    UpdateExpression: 'set dealer = :d, changed = :c',
    ExpressionAttributeValues: {
      ':d': dealer,
      ':c': changed,
    },
  };
  return this.updateItem(params);
};

module.exports = Db;
