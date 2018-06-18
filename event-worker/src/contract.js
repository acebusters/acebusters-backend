
/**
 * Copyright (c) 2017-present, Parsec Labs (parseclabs.org)
 *
 * This source code is licensed under the GNU Affero General Public License,
 * version 3, found in the LICENSE file in the root directory of this source 
 * tree.
 */

export default class Contract {

  constructor(web3, senderAddr, sqs, queueUrl) {
    this.web3 = web3;
    this.senderAddr = senderAddr;
    this.sqs = sqs;
    this.queueUrl = queueUrl;
  }

  sendTransaction(
    contractInstance,
    methodName,
    maxGas,
    args = [],
    params = {},
  ) {
    const contractMethod = contractInstance[methodName];
    return new Promise((resolve, reject) => {
      contractMethod.estimateGas(...args, (gasErr, gas) => {
        if (gasErr) {
          reject(`Estimate error: ${JSON.stringify(gasErr)}`);
        } else if (gas > maxGas) {
          reject(`Too many gas required for tx (${gas})`);
        } else {
          const callData = contractMethod.getData(...args);
          this.sqs.sendMessage({
            MessageBody: JSON.stringify({
              from: this.senderAddr,
              to: contractInstance.address,
              gas: Math.round(gas * 1.2),
              data: callData,
              ...params,
            }),
            QueueUrl: this.queueUrl,
            MessageGroupId: 'someGroup',
          }, (err, data) => {
            if (err) {
              reject(`sqs error: ${err}`);
            } else {
              resolve(data);
            }
          });
        }
      });
    });
  }

  call(method, ...args) { // eslint-disable-line class-methods-use-this
    return new Promise((resolve, reject) => {
      method(...args, (err, val) => {
        if (err) {
          return reject(err);
        }
        return resolve(val);
      });
    });
  }

}
