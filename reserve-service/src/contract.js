const TX_TIMEOUT = 10000;
const TIMEOUT_STEP = 500;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default class Contract {

  constructor(web3) {
    this.web3 = web3;
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

  async getTransaction(...args) {
    for (let i = 0; i < TX_TIMEOUT / TIMEOUT_STEP; i += 1) {
      const tx = await this.call(this.web3.eth.getTransaction, ...args); // eslint-disable-line
      if (tx) {
        return tx;
      }
      await delay(TIMEOUT_STEP); // eslint-disable-line
    }
    return null;
  }

}
