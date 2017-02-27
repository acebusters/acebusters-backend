const ethUtil = require('ethereumjs-util');

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

module.exports = TableContract;