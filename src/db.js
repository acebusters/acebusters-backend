import { dbMethod, transform } from './utils';

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

  async getLastHand(tableAddr, scanForward = false) {
    const rsp = await this.query({
      TableName: this.tableName,
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

  async updateSeat(tableAddr, handId, seat, pos, time, dealer) {
    const params = {
      TableName: this.dynamoTableName,
      Key: { tableAddr, handId },
      UpdateExpression: `set lineup[${pos}] = :s, changed = :t, dealer = :d`,
      ExpressionAttributeValues: {
        ':s': seat,
        ':t': time,
        ':d': dealer,
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

  async putHand(tableAddr, handId, lineup, dealer, deck, sb, changed) {
    try {
      const data = await this.putItem({
        TableName: this.dynamoTableName,
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
