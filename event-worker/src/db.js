import { Dynamo, Sdb } from 'ab-backend-common/db';
import { transform, range } from 'ab-backend-common/utils';

export default class WorkerDb {

  constructor(dynamo, dynamoTableName = 'sb_cashgame', sdb, sdbTableName) {
    this.dynamo = new Dynamo(dynamo, dynamoTableName);
    this.sdb = new Sdb(sdb, sdbTableName);
  }

  async setAllowance(refCode, allowance) {
    return this.sdb.putAttributes({
      ItemName: refCode,
      Attributes: [{ Name: 'allowance', Value: String(allowance), Replace: true }],
    });
  }

  async getReferral(refCode) {
    try {
      const data = await this.sdb.getAttributes({ ItemName: refCode });

      if (!data.Attributes) {
        throw new Error(`Referral with ID ${refCode} not found.`);
      }

      const referral = transform(data.Attributes);
      return {
        ...referral,
        allowance: Number(referral.allowance),
      };
    } catch (err) {
      throw new Error(`Error: ${err}`);
    }
  }

  async getHand(tableAddr, handId) {
    if (handId < 1) {
      return { distribution: {} };
    }

    const data = await this.dynamo.getItem({
      Key: { tableAddr, handId },
    });

    if (!data.Item) {
      throw new Error(`Not Found: handId ${handId} not found.`);
    }

    return data.Item;
  }

  async getHandsRange(tableAddr, fromHand, toHand) {
    const { Responses } = await this.dynamo.batchGetItem({
      RequestItems: {
        [this.dynamo.tableName]: {
          Keys: range(fromHand, toHand).map(handId => ({ handId, tableAddr })),
        },
      },
    });

    if (!Responses || !Responses[this.dynamo.tableName]) {
      throw new Error(`ho hands ${fromHand}-${toHand} found.`);
    }

    return Responses[this.dynamo.tableName];
  }

  async getLastHand(tableAddr, scanForward = false) {
    const rsp = await this.dynamo.query({
      KeyConditionExpression: 'tableAddr = :a',
      ExpressionAttributeValues: { ':a': tableAddr },
      Limit: 1,
      ScanIndexForward: scanForward,
    });

    if (!rsp.Items || rsp.Items.length < 1) {
      return Promise.reject(`Not Found: table with address ${tableAddr} unknown.`);
    }

    return rsp.Items[0];
  }

  async updateSeatLeave(tableAddr, handId, exitHand, pos, time) {
    const params = {
      Key: { tableAddr, handId },
      UpdateExpression: `set lineup[${pos}].#eh = :h, changed = :t`,
      ExpressionAttributeNames: {
        '#eh': 'exitHand',
      },
      ExpressionAttributeValues: {
        ':t': time,
        ':h': exitHand,
      },
    };

    const rsp = await this.dynamo.updateItem(params);
    return rsp.Item;
  }

  async emptySeat(tableAddr, handId, pos) {
    const params = {
      Key: { tableAddr, handId },
      UpdateExpression: `set lineup[${pos}] = :s`,
      ExpressionAttributeValues: {
        ':s': { address: '0x0000000000000000000000000000000000000000' },
      },
    };
    const rsp = await this.dynamo.updateItem(params);
    return rsp.Item;
  }

  async updateNetting(tableAddr, handId, netting) {
    const params = {
      Key: { tableAddr, handId },
      UpdateExpression: 'set netting = :n',
      ExpressionAttributeValues: {
        ':n': netting,
      },
    };
    const rsp = await this.dynamo.updateItem(params);
    return rsp.Item;
  }

  async putHand(tableAddr, handId, lineup, dealer, deck, sb, changed, started = changed) {
    try {
      const data = await this.dynamo.putItem({
        Item: {
          tableAddr,
          handId,
          lineup,
          dealer,
          state: 'waiting',
          deck,
          sb,
          changed,
          started,
        },
      });

      return data.Item;
    } catch (err) {
      throw new Error(`Error: Dynamo failed: ${err}`);
    }
  }

  async updateDistribution(tableAddr, handId, distribution) {
    const params = {
      Key: { tableAddr, handId },
      UpdateExpression: 'set distribution = :d',
      ExpressionAttributeValues: {
        ':d': distribution,
      },
    };
    const rsp = await this.dynamo.updateItem(params);
    return rsp.Item;
  }

  async markHandAsNetted(tableAddr, handId) {
    const params = {
      Key: { tableAddr, handId },
      UpdateExpression: 'set is_netted = :is_n',
      ExpressionAttributeValues: {
        ':is_n': true,
      },
    };
    const rsp = await this.dynamo.updateItem(params);
    return rsp.Item;
  }

  async deleteHand(tableAddr, handId) {
    // avoid deleting unwanted entries
    if (!handId || !tableAddr) {
      throw new Error('null key value detected on delete.');
    }

    try {
      const rsp = await this.dynamo.deleteItem({
        Key: { tableAddr, handId },
      });

      return rsp;
    } catch (err) {
      throw new Error(`Error: Dynamo failed: ${err}`);
    }
  }

}
