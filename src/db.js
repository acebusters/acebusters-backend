import { NotFound } from './errors';

function Db(dynamo, tableName) {
  this.dynamo = dynamo;
  this.tableName = (typeof tableName === 'undefined') ? 'sb_cashgame' : tableName;
}

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

Db.prototype.updateLeave = function updateLeave(tableAddr, handId, seat, pos) {
  return new Promise((fulfill, reject) => {
    const params = {
      TableName: this.tableName,
      Key: { tableAddr, handId },
      UpdateExpression: `set lineup[${pos}] = :s`,
      ExpressionAttributeValues: {
        ':s': seat,
      },
    };
    this.dynamo.updateItem(params, (err, rsp) => {
      if (err) {
        return reject(err);
      }
      return fulfill(rsp.Item);
    });
  });
};

Db.prototype.updateSeat = function updateSeat(tableAddr,
  handId, seat, pos, state, changed, streetMaxBet) {
  return new Promise((fulfill, reject) => {
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
    this.dynamo.updateItem(params, (err, rsp) => {
      if (err) {
        return reject(err);
      }
      return fulfill(rsp.Item);
    });
  });
};

Db.prototype.updateNetting = function updateNetting(tableAddr, handId, signer, nettingSig) {
  return new Promise((fulfill, reject) => {
    const params = {
      TableName: this.tableName,
      Key: {
        tableAddr,
        handId,
      },
      UpdateExpression: 'set netting.#signer = :s',
      ExpressionAttributeNames: {
        '#signer': signer,
      },
      ExpressionAttributeValues: {
        ':s': nettingSig,
      },
      ReturnValues: 'ALL_NEW',
    };
    this.dynamo.updateItem(params, (err, rsp) => {
      if (err) {
        return reject(err);
      }
      return fulfill(rsp.Item);
    });
  });
};

Db.prototype.setSeat = function setSeat(tableAddr, handId, pos, addr, sitout) {
  const address = addr || '0x0000000000000000000000000000000000000000';
  return new Promise((fulfill, reject) => {
    const params = {
      TableName: this.tableName,
      Key: { tableAddr, handId },
      UpdateExpression: `set lineup[${pos}] = :s`,
      ExpressionAttributeValues: {
        ':s': { address },
      },
    };
    if (sitout) {
      params.ExpressionAttributeValues[':s'].sitout = sitout;
    }
    this.dynamo.updateItem(params, (err, rsp) => {
      if (err) {
        reject(err);
        return;
      }
      fulfill(rsp.Item);
    });
  });
};

Db.prototype.setDealer = function setDealer(tableAddr, handId, changed, dealer) {
  return new Promise((fulfill, reject) => {
    const params = {
      TableName: this.tableName,
      Key: { tableAddr, handId },
      UpdateExpression: 'set dealer = :d, changed = :c',
      ExpressionAttributeValues: {
        ':d': dealer,
        ':c': changed,
      },
    };
    this.dynamo.updateItem(params, (err, rsp) => {
      if (err) {
        return reject(err);
      }
      return fulfill(rsp.Item);
    });
  });
};

module.exports = Db;
