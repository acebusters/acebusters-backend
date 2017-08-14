// transform from key/value to list and back
const transform = (data) => {
  let attributes;
  if (Array.isArray(data)) {
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
          Value: aValue,
          Replace: true,
        });
      });
    });
  }
  return attributes;
};

export default class Db {

  constructor(sdb, tableName) {
    this.sdb = sdb;
    this.tableName = tableName;
  }

  reserveSeat(tableAddr, pos, signerAddr, txHash, amount) {
    return this.putAttributes({
      DomainName: this.tableName,
      ItemName: `${tableAddr}-${pos}`,
      Attributes: transform({
        tableAddr: [tableAddr],
        pos: [pos],
        signerAddr: [signerAddr],
        txHash: [txHash],
        amount: [amount],
        created: [`${Math.round(Date.now() / 1000)}`],
      }),
    });
  }

  async getSeat(tableAddr, pos) {
    const data = await this.getAttributes({
      DomainName: this.tableName,
      ItemName: `${tableAddr}-${pos}`,
    });

    if (!data.Attributes) {
      return null;
    }

    return transform(data.Attributes);
  }

  async getTableReservations(tableAddr) {
    const { Items: reservations } = await this.select({
      SelectExpression: `select * from \`${this.tableName}\` where \`tableAddr\`="${tableAddr}"`,
    });

    return reservations.map(transform).reduce((memo, item) => ({
      ...memo,
      [item.pos]: {
        signerAddr: item.signerAddr,
        amount: item.amount,
        txHash: item.txHash,
      },
    }));
  }

  async cleanupOutdated(timeout) {
    const data = await this.select({
      SelectExpression: `select * from \`${this.tableName}\` where \`created\`>'${Math.round(Date.now() / 1000) + timeout}'`,
    });
    const outdated = data.Items.map(transform);

    await Promise.all(outdated.map((item, i) => this.deleteAttributes({
      DomainName: this.tableName,
      ItemName: `${item.tableAddr}-${item.pos}`,
      Attributes: data.Items[i],
    })));

    return outdated;
  }

  method(name, params) {
    return new Promise((resolve, reject) => {
      this.sdb[name](params, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

  putAttributes(params) {
    return this.method('putAttributes', params);
  }

  select(params) {
    return this.method('select', params);
  }

  getAttributes(params) {
    return this.method('getAttributes', params);
  }

  deleteAttributes(params) {
    return this.method('deleteAttributes', params);
  }

  createDomain(params) {
    return this.method('createDomain', params);
  }

}
