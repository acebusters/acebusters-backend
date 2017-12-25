import { NotFound } from './errors';

const performSeatsUpdate = (joins, leaves, sitout) => {
  const seats = {
    ...leaves.reduce((attrs, i) => ({
      ...attrs,
      [i]: { address: '0x0000000000000000000000000000000000000000' },
    }), {}),
    ...joins.reduce((attrs, seat) => ({
      ...attrs,
      [seat.pos]: sitout ? { address: seat.addr, sitout } : { address: seat.addr },
    }), {}),
  };

  return seats;
};

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

export const emulateSeatsUpdate = (hand, joins, leaves, dealer, sitout, changed) => {
  const seats = performSeatsUpdate(joins, leaves, sitout);
  return {
    ...hand,
    lineup: Object.keys(seats).reduce((lineup, pos) => {
      lineup[pos] = seats[pos]; // eslint-disable-line
      return lineup;
    }, [...hand.lineup]),
    dealer,
    changed,
  };
};

export default class Db {
  constructor(dynamo, tableName = 'tables', sdb, sdbTableName = 'requests') {
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

  getHands(tableAddr, fromHandId, toHandId) {
    if (fromHandId >= toHandId) {
      return Promise.resolve([]);
    }
    return new Promise((resolve, reject) => {
      const Keys = [];
      for (let i = fromHandId; i < toHandId; i += 1) {
        Keys.push({ tableAddr, handId: i });
      }
      this.dynamo.batchGetItem({
        RequestItems: {
          [this.tableName]: { Keys },
        },
      }, (err, data) => {
        if (err) {
          return reject(err);
        }

        if (!data.Responses || !data.Responses[this.tableName]) {
          return reject(new NotFound(`ho hands ${fromHandId}-${toHandId} found.`));
        }
        return resolve(data.Responses[this.tableName]);
      });
    });
  }

  updateLeave(tableAddr, handId, pos, exitHand, sitout, changed) {
    const params = {
      TableName: this.tableName,
      Key: { tableAddr, handId },
      UpdateExpression: 'set changed = :c',
      ExpressionAttributeNames: {},
      ExpressionAttributeValues: {
        ':c': changed,
      },
    };

    if (exitHand) {
      params.UpdateExpression += `, lineup[${pos}].#exitHand = :eh`;
      params.ExpressionAttributeNames['#exitHand'] = 'exitHand';
      params.ExpressionAttributeValues[':eh'] = exitHand;
    }

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

  updateChanged(tableAddr, handId, changed) {
    const params = {
      TableName: this.tableName,
      Key: { tableAddr, handId },
      UpdateExpression: 'set changed = :c',
      ExpressionAttributeValues: {
        ':c': changed,
      },
    };
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

  updateSeats(
    tableAddr,
    handId,
    joins,
    leaves,
    dealer,
    sb,
    sitout,
    changed,
    started,
  ) {
    const seats = performSeatsUpdate(joins, leaves, sitout);

    const expression = Object.keys(seats).map(i => `lineup[${i}] = :s${i}`);
    const params = {
      TableName: this.tableName,
      Key: { tableAddr, handId },
      UpdateExpression: `set ${[...expression, 'changed = :c', 'started = :s', 'dealer = :d', 'sb = :sb'].join(', ')}`,
      ExpressionAttributeValues: Object.keys(seats).reduce((attrs, pos) => ({
        ...attrs,
        [`:s${pos}`]: seats[pos],
      }), {
        ':c': changed,
        ':sb': sb,
        ':s': started,
        ':d': dealer,
      }),
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

