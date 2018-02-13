
class ScanManager {
  constructor(db, table, sns, factory, topicArn, logger) {
    this.db = db;
    this.factory = factory;
    this.table = table;
    this.sns = sns;
    this.topicArn = topicArn;
    this.logger = logger;
  }

  async scan(setId) {
    try {
      const [{ lastBlock }, set] = await Promise.all([
        this.db.getContractSet(setId),
        this.factory.getTables(),
      ]);

      if (!set || set.length === 0) {
        throw 'no contracts to scan'; // eslint-disable-line no-throw-literal
      }

      const blockNumber = await this.table.getBlockNumber();
      if (blockNumber <= lastBlock) {
        throw 'no new blocks'; // eslint-disable-line no-throw-literal
      }

      const events = await Promise.all(set.map(
        addr => this.table.filterContract(lastBlock, blockNumber, addr),
      ));

      await Promise.all(
        events
          .reduce((m, event) => m.concat(event), [])
          .filter(e => e)
          .map(event => this.notify(event, `ContractEvent::${event.address}`)),
      );

      return this.db.updateBlockNumber(setId, blockNumber);
    } catch (err) {
      if (err === 'no new blocks' || err === 'no contracts to scan') {
        return { status: err };
      }
      throw err;
    }
  }

  notify(event, subject) {
    return new Promise((fulfill, reject) => {
      this.sns.publish({
        Message: JSON.stringify(event),
        Subject: subject,
        TopicArn: this.topicArn,
      }, (err) => {
        if (err) {
          reject(err);
          return;
        }
        fulfill({});
      });
    });
  }
}

module.exports = ScanManager;
