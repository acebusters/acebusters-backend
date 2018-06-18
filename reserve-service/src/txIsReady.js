
/**
 * Copyright (c) 2017-present, Parsec Labs (parseclabs.org)
 *
 * This source code is licensed under the GNU Affero General Public License,
 * version 3, found in the LICENSE file in the root directory of this source 
 * tree.
 */

export default function txIsReady(web3, txHash) {
  return new Promise((resolve) => {
    web3.eth.getTransaction(txHash, (err, tx) => {
      if (err || !tx) {
        // if we have some troubles with tx
        // we need to release seat
        resolve(true);
      } else {
        web3.eth.getTransactionReceipt(txHash, (receiptErr, receipt) => {
          resolve(!err && receipt);
        });
      }
    });
  });
}
