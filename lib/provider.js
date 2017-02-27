var Web3 = require('web3');

function Provider(provider, senderAddr, tableAbi) {
  this.web3 = new Web3(provider);
  this.senderAddr = senderAddr;
  this.tableAbi = tableAbi;
}

Provider.prototype.getWeb3 = function () {
  return this.web3;
}

Provider.prototype.getTable = function (tableAddr) {
  return this.web3.eth.contract(this.tableAbi).at(tableAddr);
}

Provider.prototype.getAddress = function () {
  return this.senderAddr;
}

module.exports = Provider;
