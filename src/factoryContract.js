import ethUtil from 'ethereumjs-util';
import Contract from './contract';

const FACTORY_ABI = [{ constant: true, inputs: [{ name: '_proxy', type: 'address' }], name: 'getSigner', outputs: [{ name: '', type: 'address' }], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_signer', type: 'address' }, { name: '_lockAddr', type: 'address' }], name: 'create', outputs: [], payable: false, type: 'function' }, { constant: false, inputs: [{ name: '_newSigner', type: 'address' }], name: 'handleRecovery', outputs: [], payable: false, type: 'function' }, { constant: true, inputs: [{ name: '_signer', type: 'address' }], name: 'getAccount', outputs: [{ name: '', type: 'address' }, { name: '', type: 'address' }, { name: '', type: 'bool' }], payable: false, type: 'function' }, { anonymous: false, inputs: [{ indexed: true, name: 'signer', type: 'address' }, { indexed: false, name: 'proxy', type: 'address' }], name: 'AccountCreated', type: 'event' }, { anonymous: false, inputs: [{ indexed: true, name: 'newSigner', type: 'address' }, { indexed: false, name: 'proxy', type: 'address' }, { indexed: false, name: 'oldSigner', type: 'address' }], name: 'AccountRecovered', type: 'event' }];

export default class FactoryContract extends Contract {
  constructor(web3, senderAddr, factoryAddr) {
    super(web3, senderAddr);
    this.factoryAddr = factoryAddr;
    this.contract = this.web3.eth.contract(FACTORY_ABI).at(this.factoryAddr);
  }

  getTransactionCount() {
    return this.call(this.web3.eth.getTransactionCount, this.factoryAddr);
  }

  getNextAddr() {
    return this.getTransactionCount().then((txCount) => {
      const nextAddr = ethUtil.bufferToHex(ethUtil.generateAddress(this.factoryAddr, txCount));
      return nextAddr;
    });
  }

  getAccount(signerAddr) {
    return this.call(this.contract.getAccount, signerAddr).then(val => ({
      signer: val[0],
      owner: val[1],
      isLocked: val[2],
    }));
  }

  createAccount(signerAddr, lockAddr) {
    return this.sendTransaction(this.contract.create, 2000000, signerAddr, lockAddr);
  }
}
