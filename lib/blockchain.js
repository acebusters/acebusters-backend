const ethUtil = require('ethereumjs-util');

function Blockchain (provider) {
  this.provider = provider;
}


Blockchain.prototype.getLineup = function(tableAddr) {
  var self = this;
  var contract = this.provider.getTable(tableAddr);
  return new Promise(function (fulfill, reject) {
    contract.lineup(, function(err, lineup){
      if (err) {
        console.log('send tx error');
        console.dir(err);
        reject(err);
      }
      fulfill(lineup);
    });
  });
}

module.exports = Blockchain;