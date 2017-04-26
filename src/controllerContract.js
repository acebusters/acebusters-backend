const CONTROLLER_ABI = [{ constant: true, inputs: [], name: 'newControllerPendingUntil', outputs: [{ name: '', type: 'uint96' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'newRecoveryPendingUntil', outputs: [{ name: '', type: 'uint96' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'signer', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'newController', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'lastNonce', outputs: [{ name: '', type: 'uint96' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'version', outputs: [{ name: '', type: 'uint96' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_destination', type: 'address' }, { name: '_value', type: 'uint256' }], name: 'sendTx', outputs: [], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'newRecovery', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_newController', type: 'address' }], name: 'signControllerChange', outputs: [], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_newRecovery', type: 'address' }], name: 'signRecoveryChange', outputs: [], payable: false, type: 'function' }, { constant: false, inputs: [], name: 'changeController', outputs: [], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_nonceAndAddr', type: 'bytes32' }, { name: '_data', type: 'bytes' }, { name: '_r', type: 'bytes32' }, { name: '_s', type: 'bytes32' }, { name: '_v', type: 'uint8' }], name: 'forward', outputs: [], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_destination', type: 'address' }, { name: '_payload', type: 'bytes' }], name: 'forwardTx', outputs: [], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'timeLock', outputs: [{ name: '', type: 'uint96' }], payable: false, type: 'function' }, { constant: false, inputs: [], name: 'changeRecovery', outputs: [], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'recovery', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: true, inputs: [], name: 'proxy', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_r', type: 'bytes32' }, { name: '_s', type: 'bytes32' }, { name: '_pl', type: 'bytes32' }], name: 'changeSigner', outputs: [], payable: false, type: 'function' }, { inputs: [{ name: '_proxy', type: 'address' }, { name: '_signer', type: 'address' }, { name: '_recovery', type: 'address' }, { name: '_timeLock', type: 'uint96' }], payable: false, type: 'constructor' }, { anonymous: false, inputs: [{ indexed: false, name: 'action', type: 'bytes32' }], name: 'Event', type: 'event' }, { anonymous: false, inputs: [{ indexed: false, name: 'error', type: 'bytes32' }], name: 'Error', type: 'event' }];

function ControllerContract(web3, senderAddr) {
  this.web3 = web3;
  this.senderAddr = senderAddr;
}

ControllerContract.prototype.changeSigner = function changeSigner(controllerAddr, recoveryReceipt) {
  const contract = this.web3.eth.contract(CONTROLLER_ABI).at(controllerAddr);
  return new Promise((fulfill, reject) => {
    contract.changeSigner.sendTransaction(...recoveryReceipt,
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

module.exports = ControllerContract;
