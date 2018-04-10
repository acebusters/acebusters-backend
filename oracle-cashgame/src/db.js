import { transform, range } from 'ab-backend-common/utils';
import { Sdb, Dynamo } from 'ab-backend-common/db';
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
    this.dynamo = new Dynamo(dynamo, tableName);
    this.sdb = new Sdb(sdb, sdbTableName);
  }

  async getTableHands(tableAddr) {
    const rsp = await this.dynamo.query({
      KeyConditionExpression: 'tableAddr = :a',
      ExpressionAttributeValues: { ':a': tableAddr },
      ScanIndexForward: false,
    });

    if (!rsp.Items || rsp.Items.length < 1) {
      throw new NotFound(`table with address ${tableAddr} unknown.`);
    }

    return rsp.Items;
  }

  async getLastHand(tableAddr) {
    const rsp = await this.dynamo.query({
      KeyConditionExpression: 'tableAddr = :a',
      ExpressionAttributeValues: { ':a': tableAddr },
      Limit: 1,
      ScanIndexForward: false,
    });

    if (!rsp.Items || rsp.Items.length < 1) {
      throw new NotFound(`table with address ${tableAddr} unknown.`);
    }
    return rsp.Items[0];
  }

  async getHand(tableAddr, handId) {
    if (handId < 1) {
      // return the genensis hand
      return { handId, state: 'showdown', distribution: '0x1234' };
    }

    const data = await this.dynamo.getItem({
      Key: { tableAddr, handId },
    });

    if (!data.Item) {
      throw new NotFound(`handId ${handId} not found.`);
    }

    return data.Item;
  }

  async getHands(tableAddr, fromHandId, toHandId) {
    if (fromHandId >= toHandId) {
      return [];
    }

    const data = await this.dynamo.batchGetItem({
      RequestItems: {
        [this.dynamo.tableName]: range(fromHandId, toHandId).map(i => ({ tableAddr, handId: i })),
      },
    });
    if (!data.Responses || !data.Responses[this.dynamo.tableName]) {
      throw new NotFound(`no hands ${fromHandId}-${toHandId} found.`);
    }

    return data.Responses[this.dynamo.tableName];
  }

  updateLeave(tableAddr, handId, pos, exitHand, sitout, changed) {
    const params = {
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

    return this.dynamo.updateItem(params);
  }

  updateSeat(tableAddr,
    handId, seat, pos, state, changed, streetMaxBet) {
    const params = {
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
    return this.dynamo.updateItem(params);
  }

  updateChanged(tableAddr, handId, changed) {
    const params = {
      Key: { tableAddr, handId },
      UpdateExpression: 'set changed = :c',
      ExpressionAttributeValues: {
        ':c': changed,
      },
    };
    return this.dynamo.updateItem(params);
  }

  updateNetting(tableAddr, handId, signer, nettingSig) {
    const params = {
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
    return this.dynamo.updateItem(params);
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

    return this.dynamo.updateItem(params);
  }

  async getOpponentCallRequest(tableAddr) {
    const data = await this.sdb.getAttributes({ ItemName: tableAddr });

    return data.Attributes && transform(data.Attributes);
  }

  async addOpponentCallRequest(tableAddr) {
    await this.sdb.putAttributes({
      ItemName: tableAddr,
      Attributes: [
        { Name: 'created', Value: String(Math.round(Date.now() / 1000)) },
      ],
    });
  }
}

