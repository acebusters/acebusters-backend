import { Sdb } from 'ab-backend-common/db';

export default class ScannerDb {
  constructor(sdb, tableName = 'blocks') {
    this.blocksDb = new Sdb(sdb, tableName);
  }

  async getContractSet(setId) {
    const data = await this.blocksDb.getAttributes({ ItemName: setId });
    if (!data || !data.Attributes) {
      throw `Error: entry ${setId} not found.`; // eslint-disable-line no-throw-literal
    }
    const lastBlock = data.Attributes.find(pair => pair.Name === 'lastBlock');

    if (lastBlock) {
      return { lastBlock: Number(lastBlock.Value) };
    }

    return {
      lastBlock: 0,
    };
  }

  updateBlockNumber(setId, blockNumber) {
    return this.blocksDb.putAttributes({
      ItemName: setId,
      Attributes: [{
        Name: 'lastBlock',
        Replace: true,
        Value: blockNumber.toString(),
      }],
    });
  }

}
