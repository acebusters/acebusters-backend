const TABLE_ABI = [{ constant: false, inputs: [{ name: '_spender', type: 'address' }, { name: '_value', type: 'uint256' }], name: 'approve', outputs: [{ name: 'success', type: 'bool' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'totalSupply', outputs: [{ name: '', type: 'uint256' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_value', type: 'uint256' }], name: 'revoke', outputs: [{ name: 'success', type: 'bool' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_from', type: 'address' }, { name: '_to', type: 'address' }, { name: '_value', type: 'uint256' }], name: 'transferFrom', outputs: [{ name: 'success', type: 'bool' }], payable: false, type: 'function' }, { constant: true, inputs: [{ name: '_holder', type: 'address' }], name: 'balanceOf', outputs: [{ name: 'balance', type: 'uint256' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'owner', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_newOwner', type: 'address' }], name: 'changeOwner', outputs: [{ name: 'success', type: 'bool' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_to', type: 'address' }, { name: '_value', type: 'uint256' }], name: 'transfer', outputs: [{ name: 'success', type: 'bool' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'baseUnit', outputs: [{ name: '', type: 'uint96' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_value', type: 'uint256' }], name: 'issue', outputs: [{ name: 'success', type: 'bool' }], payable: false, type: 'function' }, { constant: true, inputs: [{ name: '_holder', type: 'address' }, { name: '_spender', type: 'address' }], name: 'allowance', outputs: [{ name: 'remaining', type: 'uint256' }], payable: false, type: 'function' }, { inputs: [{ name: '_owner', type: 'address' }, { name: '_baseUnit', type: 'uint96' }], type: 'constructor' }, { anonymous: false, inputs: [{ indexed: true, name: 'from', type: 'address' }, { indexed: true, name: 'to', type: 'address' }, { indexed: false, name: 'value', type: 'uint256' }], name: 'Transfer', type: 'event' }, { anonymous: false, inputs: [{ indexed: true, name: 'to', type: 'address' }, { indexed: false, name: 'value', type: 'uint256' }], name: 'Issuance', type: 'event' }, { anonymous: false, inputs: [{ indexed: true, name: 'from', type: 'address' }, { indexed: false, name: 'value', type: 'uint256' }], name: 'Revoke', type: 'event' }, { anonymous: false, inputs: [{ indexed: true, name: 'owner', type: 'address' }, { indexed: true, name: 'spender', type: 'address' }, { indexed: false, name: 'value', type: 'uint256' }], name: 'Approval', type: 'event' }, { anonymous: false, inputs: [{ indexed: false, name: 'sender', type: 'address' }, { indexed: false, name: 'code', type: 'uint256' }], name: 'Error', type: 'event' }];

function TableContract(web3, senderAddr) {
  this.web3 = web3;
  this.senderAddr = senderAddr;
}

TableContract.prototype.leave = function (tableAddr, leaveReceipt) {
  const contract = this.web3.eth.contract(TABLE_ABI).at(tableAddr);
  return new Promise((fulfill, reject) => {
    contract.leave.sendTransaction(leaveReceipt,
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

TableContract.prototype.settle = function (tableAddr, newBalances, sigs) {
  const contract = this.web3.eth.contract(TABLE_ABI).at(tableAddr);
  return new Promise((fulfill, reject) => {
    contract.settle.sendTransaction(newBalances, sigs,
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

TableContract.prototype.net = function (tableAddr) {
  const contract = this.web3.eth.contract(TABLE_ABI).at(tableAddr);
  return new Promise((fulfill, reject) => {
    contract.net.sendTransaction({ from: this.senderAddr, gas: 2600000 },
      (err, val) => {
        if (err) {
          reject(err);
          return;
        }
        fulfill(val);
      });
  });
};

TableContract.prototype.submitDists = function (tableAddr, distsHex, sigsHex) {
  const contract = this.web3.eth.contract(TABLE_ABI).at(tableAddr);
  return new Promise((fulfill, reject) => {
    contract.submitDists.sendTransaction(distsHex, sigsHex,
      { from: this.senderAddr, gas: 1900000 },
      (err, val) => {
        if (err) {
          reject(err);
          return;
        }
        fulfill(val);
      });
  });
};

TableContract.prototype.submitBets = function (tableAddr, betsHex, sigsHex) {
  const contract = this.web3.eth.contract(TABLE_ABI).at(tableAddr);
  return new Promise((fulfill, reject) => {
    contract.submitBets.sendTransaction(betsHex, sigsHex,
      { from: this.senderAddr, gas: 1900000 },
      (err, val) => {
        if (err) {
          reject(err);
          return;
        }
        fulfill(val);
      });
  });
};

TableContract.prototype.payout = function (tableAddr, signerAddr) {
  const contract = this.web3.eth.contract(TABLE_ABI).at(tableAddr);
  return new Promise((fulfill, reject) => {
    contract.payoutFrom.sendTransaction(signerAddr,
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

TableContract.prototype.getSmallBlind = function (tableAddr) {
  const contract = this.web3.eth.contract(TABLE_ABI).at(tableAddr);
  return new Promise((fulfill, reject) => {
    contract.smallBlind.call((err, val) => {
      if (err) {
        reject(err);
        return;
      }
      fulfill(val.toNumber());
    });
  });
};

TableContract.prototype.getLineup = function (tableAddr) {
  const contract = this.web3.eth.contract(TABLE_ABI).at(tableAddr);
  return new Promise((fulfill, reject) => {
    contract.getLineup.call((err, data) => {
      let error = err;
      if (!err && (!data || data.length < 4)) {
        error = 'lineup response invalid.';
      }
      if (error) {
        reject(error);
        return;
      }
      const rv = [];
      for (let i = 0; i < data[1].length; i += 1) {
        rv.push({
          address: data[1][i],
          amount: data[2][i].toNumber(),
          exitHand: data[3][i].toNumber(),
        });
      }
      fulfill({
        lastHandNetted: data[0].toNumber(),
        lineup: rv,
      });
    });
  });
};

module.exports = TableContract;
