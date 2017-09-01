export default class Contract {

  constructor(web3, senderAddr, sqs, queueUrl) {
    this.web3 = web3;
    this.senderAddr = senderAddr;
    this.sqs = sqs;
    this.queueUrl = queueUrl;
  }

  sendTransaction(
    tableAddr,
    contractMethod,
    maxGas,
    ...args
  ) {
    return new Promise((resolve, reject) => {
      contractMethod.estimateGas(...args, (gasErr, gas) => {
        if (gasErr) {
          reject(`Estimate error: ${JSON.stringify(gasErr)}`);
        } else if (gas > maxGas) {
          reject(`Too many gas required for tx (${gas})`);
        } else {
          const callData = contractMethod.getData(...args);
          this.sqs.sendMessage({ MessageBody: JSON.stringify({
              from: this.senderAddr,
              to: tableAddr,
              gas: Math.round(gas * 1.2),
              data: callData
            }),
            QueueUrl: this.queueUrl,
            MessageGroupId: 'someGroup'
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
