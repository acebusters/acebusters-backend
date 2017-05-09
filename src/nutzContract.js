const NUTZ_ABI = [{ constant: true, inputs: [], name: 'totalSupply', outputs: [{ name: '', type: 'uint256' }], payable: false, type: 'function' }, { constant: true, inputs: [{ name: 'who', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }], name: 'transfer', outputs: [{ name: '', type: 'bool' }], payable: false, type: 'function' }, { anonymous: false, inputs: [{ indexed: true, name: 'from', type: 'address' }, { indexed: true, name: 'to', type: 'address' }, { indexed: false, name: 'value', type: 'uint256' }], name: 'Transfer', type: 'event' }];

function NutzContract(web3, senderAddr, nutzAddr) {
  this.web3 = web3;
  this.senderAddr = senderAddr;
  this.nutzAddr = nutzAddr;
}

NutzContract.prototype.transfer = function transfer(to, value) {
  const contract = this.web3.eth.contract(NUTZ_ABI).at(this.nutzAddr);
  return new Promise((fulfill, reject) => {
    contract.transfer.sendTransaction(to, value,
      { from: this.senderAddr, gas: 200000 },
      (err, val) => {
        if (err) {
          reject(err);
          return;
        }
        fulfill(val);
      });
  });
};

NutzContract.prototype.balanceOf = function balanceOf(owner) {
  const contract = this.web3.eth.contract(NUTZ_ABI).at(this.nutzAddr);
  return new Promise((fulfill, reject) => {
    contract.balanceOf.call(owner, (err, val) => {
      if (err) {
        reject(err);
        return;
      }
      fulfill(val.toNumber());
    });
  });
};

module.exports = NutzContract;
