export default class Contract {

  constructor(web3, senderAddr, sqs, queueUrl) {
    this.web3 = web3;
    this.senderAddr = senderAddr;
    this.sqs = sqs;
    this.queueUrl = queueUrl;
  }

  async sendContractTransaction(
    contractInstance,
    methodName,
    maxGas,
    args = [],
    params = {},
  ) {
    const contractMethod = contractInstance[methodName];
    const callData = contractMethod.getData(...args);
    const gas = await this.estimateGas(contractMethod, args, maxGas);

    return this.sendTransaction(this.senderAddr, contractInstance.address, {
      gas: Math.round(gas * 1.2),
      data: callData,
      ...params,
    });
  }

  getBalance(...args) {
    return this.call(this.web3.eth.getBalance, ...args);
  }

  getTransaction(...args) {
    return this.call(this.web3.eth.getTransaction, ...args);
  }

  getBlockNumber() {
    return this.call(this.web3.eth.getBlockNumber);
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

  sendTransaction(from, to, params = {}) {
    return new Promise((resolve, reject) => {
      this.sqs.sendMessage({
        MessageBody: JSON.stringify({
          from,
          to,
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
    });
  }

  estimateGas(contractMethod, args, maxGas) {
    return new Promise((resolve, reject) => {
      contractMethod.estimateGas(...args, { from: this.senderAddr }, (gasErr, gas) => {
        if (gasErr) {
          reject(`Error: Estimate error: ${JSON.stringify(gasErr)}`);
        } else if (maxGas && gas > maxGas) {
          reject(`Error: Too much gas required for tx (${gas})`);
        } else {
          resolve(Math.round(gas * 1.2));
        }
      });
    });
  }

}
