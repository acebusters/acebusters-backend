import { NotFound } from './errors';

const transform = (data) => {
  let attributes;
  if (data && data.forEach) {
    attributes = {};
    data.forEach((aPair) => {
      if (!attributes[aPair.Name]) {
        attributes[aPair.Name] = {};
      }
      attributes[aPair.Name] = aPair.Value;
    });
  } else {
    attributes = [];
    Object.keys(data).forEach((anAttributeName) => {
      data[anAttributeName].forEach((aValue) => {
        attributes.push({
          Name: anAttributeName,
          Value: [aValue],
          Replace: true,
        });
      });
    });
  }
  return attributes;
};

export default class Db {
  constructor(dynamo, tableName, sdb, sdbTableName) {
    this.dynamo = dynamo;
    this.tableName = tableName;
    this.sdb = sdb;
    this.sdbTableName = sdbTableName;
  }

  updateItem(params) {
    return new Promise((fulfill, reject) => {
      this.dynamo.updateItem(params, (err, rsp) => {
        if (err) {
          return reject(err);
        }
        return fulfill(rsp.Item);
      });
    });
  }

  getTableHands(tableAddr) {
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
  }

  getLastHand(tableAddr) {
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
  }

  getHand(tableAddr, handId) {
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
  }

  updateLeave(tableAddr, handId, pos, exitHand, sitout, changed) {
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
  }

  updateSeat(tableAddr,
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
  }

  updateNetting(tableAddr, handId, signer, nettingSig) {
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
  }

  setSeat(tableAddr, handId, pos, changed, addr, sitout) {
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
  }

  emptySeat(tableAddr, handId, pos, changed) {
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
  }

  setDealer(tableAddr, handId, changed, dealer) {
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
  }

  getOpponentCallRequest(tableAddr) {
    return new Promise((resolve, reject) => {
      this.sdb.getAttributes({
        DomainName: this.sdbTableName,
        ItemName: tableAddr,
      }, (err, data) => {
        if (err) {
          return reject(`Error: ${err}`);
        }
        return resolve(data.Attributes && transform(data.Attributes));
      });
    });
  }

  addOpponentCallRequest(tableAddr) {
    return new Promise((resolve, reject) => {
      this.sdb.putAttributes({
        DomainName: this.sdbTableName,
        ItemName: tableAddr,
        Attributes: [
          { Name: 'created', Value: String(Math.round(Date.now() / 1000)) },
        ],
      }, (err) => {
        if (err) {
          return reject(err);
        }
        return resolve();
      });
    });
  }
}

