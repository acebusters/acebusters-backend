import Contract from './contract';

const NUTZ_ABI = [{ constant: true, inputs: [], name: 'totalSupply', outputs: [{ name: '', type: 'uint256' }], payable: false, type: 'function' }, { constant: true, inputs: [{ name: 'who', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }], name: 'transfer', outputs: [{ name: '', type: 'bool' }], payable: false, type: 'function' }, { anonymous: false, inputs: [{ indexed: true, name: 'from', type: 'address' }, { indexed: true, name: 'to', type: 'address' }, { indexed: false, name: 'value', type: 'uint256' }], name: 'Transfer', type: 'event' }];

export default class NutzContract extends Contract {
  constructor(web3, senderAddr, nutzAddr) {
    super(web3, senderAddr);
    this.contract = this.web3.eth.contract(NUTZ_ABI).at(nutzAddr);
  }

  transfer(to, value) {
    return this.sendTransaction(this.contract.transfer, 200000, to, value);
  }

  balanceOf(owner) {
    return new Promise((fulfill, reject) => {
      this.contract.balanceOf.call(owner, (err, val) => {
        if (err) {
          reject(err);
          return;
        }
        fulfill(val.toNumber());
      });
    });
  }

}

