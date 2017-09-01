import ethUtil from 'ethereumjs-util';
import Contract from './contract';

const FACTORY_ABI = [{ constant: true, inputs: [{ name: '_proxy', type: 'address' }], name: 'getSigner', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_signer', type: 'address' }, { name: '_lockAddr', type: 'address' }], name: 'create', outputs: [], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_newSigner', type: 'address' }], name: 'handleRecovery', outputs: [], payable: false, type: 'function' }, { constant: true, inputs: [{ name: '_signer', type: 'address' }], name: 'getAccount', outputs: [{ name: '', type: 'address' }, { name: '', type: 'address' }, { name: '', type: 'bool' }], payable: false, type: 'function' }, { anonymous: false, inputs: [{ indexed: true, name: 'signer', type: 'address' }, { indexed: false, name: 'proxy', type: 'address' }], name: 'AccountCreated', type: 'event' }, { anonymous: false, inputs: [{ indexed: true, name: 'newSigner', type: 'address' }, { indexed: false, name: 'proxy', type: 'address' }, { indexed: false, name: 'oldSigner', type: 'address' }], name: 'AccountRecovered', type: 'event' }];

export default class FactoryContract {
  constructor(web3, senderAddr, factoryAddr, sqs, queueUrl) {
    this.web3 = web3;
    this.senderAddr = senderAddr;
    this.factoryAddr = factoryAddr;
    this.contract = this.web3.eth.contract(FACTORY_ABI).at(this.factoryAddr);
    this.sqs = sqs;
    this.queueUrl = queueUrl;
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

  getAccount(signerAddr) {
    return this.call(this.contract.getAccount.call, signerAddr).then(val => ({
      signer: val[0],
      owner: val[1],
      isLocked: val[2],
    }));
  }

  createAccount(signerAddr, lockAddr) {
    return new Promise((resolve, reject) => {
      this.contract.create.estimateGas(signerAddr, lockAddr, (gasErr, gas) => {
        if (gasErr) {
          reject(`Estimate error: ${JSON.stringify(gasErr)}`);
        } else if (gas > 2000000) {
          reject(`Too many gas required for tx (${gas})`);
        } else {
          const callData = this.contract.create.getData(signerAddr, lockAddr);
          this.sqs.sendMessage({ MessageBody: JSON.stringify({
              from: this.senderAddr,
              to: this.factoryAddr,
              gas: Math.round(gas * 1.2),
              data: callData,
              signerAddr
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
}
