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

}
