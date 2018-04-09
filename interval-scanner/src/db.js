import { Sdb } from 'ab-backend-common/db';

export default class ProxiesDb {
  constructor(sdb, proxyTable = 'ab-proxies') {
    this.proxies = new Sdb(sdb, proxyTable);
  }

  getTableName() {
    return this.proxies.tableName;
  }

  async getAvailableProxiesCount() {
    const data = await this.proxies.select({
      SelectExpression: `select count(*) from \`${this.proxies.tableName}\``,
    });

    return data.Items ? data.Items[0].Attributes[0].Value : 0;
  }
}
