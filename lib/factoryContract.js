const FACTORY_ABI = [{"constant":false,"inputs":[{"name":"_oldSigner","type":"address"},{"name":"_newSigner","type":"address"}],"name":"handleRecovery","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"}],"name":"signerToController","outputs":[{"name":"","type":"address"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"}],"name":"signerToProxy","outputs":[{"name":"","type":"address"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_signer","type":"address"},{"name":"_proxy","type":"address"},{"name":"_controller","type":"address"}],"name":"register","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_signer","type":"address"}],"name":"getAccount","outputs":[{"name":"","type":"address"},{"name":"","type":"address"},{"name":"","type":"uint96"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_signer","type":"address"},{"name":"_recovery","type":"address"},{"name":"_timeLock","type":"uint256"}],"name":"create","outputs":[],"payable":false,"type":"function"},{"anonymous":false,"inputs":[{"indexed":true,"name":"signer","type":"address"},{"indexed":false,"name":"proxy","type":"address"},{"indexed":false,"name":"controller","type":"address"},{"indexed":false,"name":"recovery","type":"address"}],"name":"AccountCreated","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"newSigner","type":"address"},{"indexed":false,"name":"proxy","type":"address"},{"indexed":false,"name":"oldSigner","type":"address"}],"name":"AccountRecovered","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"code","type":"uint256"}],"name":"Error","type":"event"}];

function FactoryContract(web3, senderAddr, factoryAddr) {
  this.web3 = web3;
  this.senderAddr = senderAddr;
  this.factoryAddr = factoryAddr;
}

FactoryContract.prototype.createAccount = function(signerAddr) {
  var self = this;
  var contract = this.web3.eth.contract(FACTORY_ABI).at(this.factoryAddr);
  return new Promise(function (fulfill, reject) {
    contract.create.sendTransaction(signerAddr, self.senderAddr, 259200, {from: self.senderAddr, gas: 2000000}, function(err, val){
      if (err) {
        console.log(JSON.stringify(err));
        reject(JSON.stringify(err));
        return;
      }
      fulfill(val);
    });
  });  
}

module.exports = FactoryContract;
