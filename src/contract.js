export default class Contract {

  constructor(web3) {
    this.web3 = web3;
  }

  call(contractMethod, ...args) { // eslint-disable-line class-methods-use-this
    const callee = contractMethod.call === Function.prototype.call ? contractMethod
                                                                   : contractMethod.call;
    return new Promise((resolve, reject) => {
      callee(...args, (err, val) => {
        if (err) {
          return reject(err);
        }
        return resolve(val);
      });
    });
  }

}
