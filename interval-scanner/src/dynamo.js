import { Dynamo } from 'ab-backend-common/db';

export default class TablesDb {
  constructor(dynamo, tableName = 'sb_cashgame') {
    this.dynamo = new Dynamo(dynamo, tableName);
  }

  async getLastHand(tableAddr) {
    const rsp = await this.dynamo.query({
      KeyConditionExpression: 'tableAddr = :a',
      ExpressionAttributeValues: { ':a': tableAddr },
      Limit: 1,
      ScanIndexForward: false,
    });

    if (!rsp.Items || rsp.Items.length < 1) {
      throw `Not Found: table with address ${tableAddr} unknown.`; // eslint-disable-line no-throw-literal
    }

    return rsp.Items[0];
  }
}
