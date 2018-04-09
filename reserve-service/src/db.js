import { transform } from 'ab-backend-common/utils';
import { Sdb } from 'ab-backend-common/db';

export default class Db {

  constructor(sdb, tableName) {
    this.sdb = new Sdb(sdb, tableName);
  }

  reserveSeat(tableAddr, pos, signerAddr, txHash, amount) {
    return this.sdb.putAttributes({
      ItemName: `${tableAddr}-${pos}`,
      Attributes: [
        { Name: 'tableAddr', Value: tableAddr },
        { Name: 'pos', Value: String(pos) },
        { Name: 'signerAddr', Value: signerAddr },
        { Name: 'txHash', Value: txHash },
        { Name: 'amount', Value: amount },
        { Name: 'created', Value: String(Math.round(Date.now() / 1000)) },
      ],
    });
  }

  async getSeat(tableAddr, pos) {
    const data = await this.sdb.getAttributes({
      ItemName: `${tableAddr}-${pos}`,
    });

    if (!data.Attributes) {
      return null;
    }

    return transform(data.Attributes);
  }

  async getTableReservations(tableAddr) {
    const { Items: reservations = [] } = await this.sdb.select({
      SelectExpression: `select * from \`${this.sdb.tableName}\` where \`tableAddr\`="${tableAddr}"`,
    });

    return reservations.map(item => transform(item.Attributes)).reduce((memo, item) => ({
      ...memo,
      [item.pos]: {
        signerAddr: item.signerAddr,
        amount: item.amount,
        txHash: item.txHash,
      },
    }), {});
  }

  async getReservations() {
    const { Items = [] } = await this.sdb.select({
      SelectExpression: `select * from \`${this.sdb.tableName}\``,
    });

    return Items.map(item => transform(item.Attributes));
  }

  async deleteItems(items) {
    return items.map(item => this.sdb.deleteAttributes({
      ItemName: `${item.tableAddr}-${item.pos}`,
      Attributes: transform(item),
    }));
  }

}
