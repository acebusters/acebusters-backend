
function TableContract (provider) {
  this.provider = provider;
}

TableContract.prototype.leave = function(tableAddr, leaveReceipt) {
  var self = this;
  var contract = this.provider.getTable(tableAddr);
  return new Promise(function (fulfill, reject) {
    contract.leave.sendTransaction(leaveReceipt, {from: self.provider.getAddress(), gas: 200000}, function(err, val){
      if (err) {
        console.log(JSON.stringify(err));
        reject(JSON.stringify(err));
        return;
      }
      fulfill(val);
    });
  });  
}

TableContract.prototype.getLineup = function(tableAddr) {
  var self = this;
  var contract = this.provider.getTable(tableAddr);
  return new Promise(function (fulfill, reject) {
    contract.getLineup.call(function(err, lineup){
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

module.exports = TableContract;