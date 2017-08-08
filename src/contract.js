export default class Contract {

  constructor(web3, senderAddr) {
    this.web3 = web3;
    this.senderAddr = senderAddr;
  }

  sendTransaction(
    contractMethod,
    maxGas,
    ...args
  ) {
    return new Promise((fulfill, reject) => {
      contractMethod.estimateGas(...args, (gasErr, estimate) => {
        const gas = Math.round(estimate * 1.2);
        if (gasErr) {
          reject(`Estimate error: ${JSON.stringify(gasErr)}`);
        } else if (gas > maxGas) {
          reject(`Too many gas required for tx (${gas})`);
        } else {
          contractMethod.sendTransaction(
            ...args,
            { from: this.senderAddr, gas },
            (txErr, txHash) => {
              if (txErr) {
                return reject(`Tx error: ${txErr}`);
              }
              return fulfill(txHash);
            },
          );
        }
      });
    });
  }

}
