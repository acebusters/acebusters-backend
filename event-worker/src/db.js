import { dbMethod, transform, range } from './utils';

export default class Db {

  constructor(dynamo, dynamoTableName = 'sb_cashgame', sdb, sdbTableName) {
    this.sdb = sdb;
    this.dynamo = dynamo;
    this.sdbTableName = sdbTableName;
    this.dynamoTableName = dynamoTableName;
  }

  async setAllowance(refCode, allowance) {
    return this.putAttributes({
      DomainName: this.sdbTableName,
      ItemName: refCode,
      Attributes: [{ Name: 'allowance', Value: String(allowance), Replace: true }],
    });
  }

  async getReferral(refCode) {
    try {
      const data = await this.getAttributes({
        DomainName: this.sdbTableName,
        ItemName: refCode,
      });

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

    const data = await this.getItem({
      TableName: this.dynamoTableName,
      Key: { tableAddr, handId },
    });

    if (!data.Item) {
      throw new Error(`Not Found: handId ${handId} not found.`);
    }

    return data.Item;
  }

  async getHandsRange(tableAddr, fromHand, toHand) {
    const { Responses } = await this.batchGetItem({
      RequestItems: {
        [this.dynamoTableName]: {
          Keys: range(fromHand, toHand).map(handId => ({ handId, tableAddr })),
        },
      },
    });

    if (!Responses || !Responses[this.dynamoTableName]) {
      throw new Error(`ho hands ${fromHand}-${toHand} found.`);
    }

    return Responses[this.dynamoTableName];
  }

  async getLastHand(tableAddr, scanForward = false) {
    const rsp = await this.query({
      TableName: this.dynamoTableName,
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
      TableName: this.dynamoTableName,
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

    const rsp = await this.updateItem(params);
    return rsp.Item;
  }

  async emptySeat(tableAddr, handId, pos) {
    const params = {
      TableName: this.dynamoTableName,
      Key: { tableAddr, handId },
      UpdateExpression: `set lineup[${pos}] = :s`,
      ExpressionAttributeValues: {
        ':s': { address: '0x0000000000000000000000000000000000000000' },
      },
    };
    const rsp = await this.updateItem(params);
    return rsp.Item;
  }

  async updateNetting(tableAddr, handId, netting) {
    const params = {
      TableName: this.dynamoTableName,
      Key: { tableAddr, handId },
      UpdateExpression: 'set netting = :n',
      ExpressionAttributeValues: {
        ':n': netting,
      },
    };
    const rsp = await this.updateItem(params);
    return rsp.Item;
  }

  async putHand(tableAddr, type, handId, lineup, dealer, deck, sb, changed, started = changed) {
    try {
      const data = await this.putItem({
        TableName: this.dynamoTableName,
        Item: {
          tableAddr,
          type,
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
      TableName: this.dynamoTableName,
      Key: { tableAddr, handId },
      UpdateExpression: 'set distribution = :d',
      ExpressionAttributeValues: {
        ':d': distribution,
      },
    };
    const rsp = await this.updateItem(params);
    return rsp.Item;
  }

  async markHandAsNetted(tableAddr, handId) {
    const params = {
      TableName: this.dynamoTableName,
      Key: { tableAddr, handId },
      UpdateExpression: 'set is_netted = :is_n',
      ExpressionAttributeValues: {
        ':is_n': true,
      },
    };
    const rsp = await this.updateItem(params);
    return rsp.Item;
  }

  async deleteHand(tableAddr, handId) {
    // avoid deleting unwanted entries
    if (!handId || !tableAddr) {
      throw new Error('null key value detected on delete.');
    }

    try {
      const rsp = await this.deleteItem({
        TableName: this.dynamoTableName,
        Key: { tableAddr, handId },
      });

      return rsp;
    } catch (err) {
      throw new Error(`Error: Dynamo failed: ${err}`);
    }
  }

  query(params) {
    return dbMethod(this.dynamo, 'query', params);
  }

  putItem(params) {
    return dbMethod(this.dynamo, 'putItem', params);
  }

  getItem(params) {
    return dbMethod(this.dynamo, 'getItem', params);
  }

  batchGetItem(params) {
    return dbMethod(this.dynamo, 'batchGetItem', params);
  }

  updateItem(params) {
    return dbMethod(this.dynamo, 'updateItem', params);
  }

  deleteItem(params) {
    return dbMethod(this.dynamo, 'deleteItem', params);
  }

  putAttributes(params) {
    return dbMethod(this.sdb, 'putAttributes', params);
  }

  select(params) {
    return dbMethod(this.sdb, 'select', params);
  }

  getAttributes(params) {
    return dbMethod(this.sdb, 'getAttributes', params);
  }

  deleteAttributes(params) {
    return dbMethod(this.sdb, 'deleteAttributes', params);
  }

  createDomain(params) {
    return dbMethod(this.sdb, 'createDomain', params);
  }

}
