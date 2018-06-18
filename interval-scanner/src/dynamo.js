
/**
 * Copyright (c) 2017-present, Parsec Labs (parseclabs.org)
 *
 * This source code is licensed under the GNU Affero General Public License,
 * version 3, found in the LICENSE file in the root directory of this source 
 * tree.
 */

function Dynamo(dynamo, tableName) {
  this.dynamo = dynamo;
  this.tableName = (typeof tableName === 'undefined') ? 'sb_cashgame' : tableName;
}


Dynamo.prototype.getLastHand = function getLastHand(tableAddr) {
  return new Promise((fulfill, reject) => {
    this.dynamo.query({
      TableName: this.tableName,
      KeyConditionExpression: 'tableAddr = :a',
      ExpressionAttributeValues: { ':a': tableAddr },
      Limit: 1,
      ScanIndexForward: false,
    }, (err, rsp) => {
      if (err) {
        reject(err);
        return;
      }
      if (!rsp.Items || rsp.Items.length < 1) {
        reject(`Not Found: table with address ${tableAddr} unknown.`);
        return;
      }
      fulfill(rsp.Items[0]);
    });
  });
};

module.exports = Dynamo;
