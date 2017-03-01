
function Contract (web3) {
  this.web3 = web3;
}

Contract.prototype.getBlockNumber = function() {
  const self = this;
  return new Promise(function (fulfill, reject) {
    self.web3.eth.getBlockNumber(function(err, number){
      if (err) {
        reject('Error: ' + err.toString());
        return;
      }
      fulfill(number);
    })
  });
}

Contract.prototype.filterContract = function(fromBlock, toBlock, abi, address) {
  const contract = this.web3.eth.contract(abi).at(address);
  return new Promise(function (fulfill, reject) {
    const filter = contract.allEvents({
      fromBlock: fromBlock,
      toBlock: toBlock
    });
    filter.get(function(err, events){
      if (err) {
        reject('Error: ' + err.toString());
        return;
      }
      fulfill(events);
    });
  });
}

module.exports = Contract;
