const ethUtil = require('ethereumjs-util');

function Blockchain (provider) {
  this.provider = provider;
}

Blockchain.prototype.getParams = function(tableAddr) {
  var self = this;
  var contract = this.provider.getTable(tableAddr);
  return new Promise(function (fulfill, reject) {
    contract.smallBlind(function(err, val){
      if (err) {
        reject(err);
      }
      let bigBlind = val.toNumber() * 2;
      fulfill({
        minBuyin: 20 * bigBlind,
        maxBuyin: 100 * bigBlind,
        bigBlind: bigBlind
      });
    });
  });  
}

Blockchain.prototype.getLineup = function(tableAddr) {
  var self = this;
  var contract = this.provider.getTable(tableAddr);
  return new Promise(function (fulfill, reject) {
    contract.getLineup(function(err, lineup){
      if (err) {
        console.log('send tx error');
        console.dir(err);
        reject(err);
      }
      var rv = [];
      for (var i = 0; i < lineup[1].length; i ++) {
        rv.push({
          address: lineup[1][i],
          amount: lineup[2][i]
        });
        if (lineup[3][i] > 0)
          rv[i].exitHand = lineup[3][i]
      }
      fulfill({
        lastHandNetted: lineup[0],
        lineup: rv
      });
    });
  });
}

module.exports = Blockchain;