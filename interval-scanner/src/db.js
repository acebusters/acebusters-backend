
/**
 * Copyright (c) 2017-present, Parsec Labs (parseclabs.org)
 *
 * This source code is licensed under the GNU Affero General Public License,
 * version 3, found in the LICENSE file in the root directory of this source 
 * tree.
 */

function Db(sdb, proxyTable = 'ab-proxies') {
  this.sdb = sdb;
  this.proxyDomain = proxyTable;
}

Db.prototype.getTableName = function getTableName() {
  return this.proxyDomain;
};

Db.prototype.getAvailableProxiesCount = function getAvailableProxiesCount() {
  return new Promise((fulfill, reject) => {
    this.sdb.select({
      SelectExpression: `select count(*) from \`${this.proxyDomain}\``,
    }, (err, data) => {
      if (err) {
        return reject(`Error: ${err}`);
      }
      return fulfill(data.Items ? data.Items[0].Attributes[0].Value : 0);
    });
  });
};

module.exports = Db;
