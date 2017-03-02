const TABLE_ABI = [{"constant":false,"inputs":[{"name":"_leaveReceipt","type":"bytes"}],"name":"leave","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"","type":"uint256"}],"name":"seats","outputs":[{"name":"senderAddr","type":"address"},{"name":"amount","type":"uint96"},{"name":"signerAddr","type":"address"},{"name":"lastHand","type":"uint96"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"lastNettingRequestTime","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"lastHandNetted","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_sender","type":"address"}],"name":"payoutFrom","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_newBalances","type":"bytes"},{"name":"_sigs","type":"bytes"}],"name":"settle","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[],"name":"payout","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_now","type":"uint256"}],"name":"netHelp","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"oracle","outputs":[{"name":"","type":"address"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"","type":"uint256"}],"name":"hands","outputs":[{"name":"claimCount","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_buyIn","type":"uint96"},{"name":"_signerAddr","type":"address"},{"name":"_pos","type":"uint256"}],"name":"join","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"getLineup","outputs":[{"name":"","type":"uint256"},{"name":"addr","type":"address[]"},{"name":"amount","type":"uint256[]"},{"name":"lastHand","type":"uint96[]"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_bets","type":"bytes"},{"name":"_sigs","type":"bytes"}],"name":"submitBets","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"lastNettingRequestHandId","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[],"name":"net","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"}],"name":"seatMap","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_handId","type":"uint96"},{"name":"_addr","type":"address"}],"name":"getIn","outputs":[{"name":"","type":"uint96"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"smallBlind","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_handId","type":"uint96"},{"name":"_addr","type":"address"}],"name":"getOut","outputs":[{"name":"","type":"uint96"},{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_dists","type":"bytes"},{"name":"_sigs","type":"bytes"}],"name":"submitDists","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"token","outputs":[{"name":"","type":"address"}],"payable":false,"type":"function"},{"inputs":[{"name":"_token","type":"address"},{"name":"_oracle","type":"address"},{"name":"_smallBlind","type":"uint256"},{"name":"_seats","type":"uint256"}],"payable":false,"type":"constructor"},{"anonymous":false,"inputs":[{"indexed":false,"name":"addr","type":"address"},{"indexed":false,"name":"amount","type":"uint256"}],"name":"Join","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"hand","type":"uint256"}],"name":"NettingRequest","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"hand","type":"uint256"}],"name":"Netted","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"errorCode","type":"uint256"}],"name":"Error","type":"event"}];

function TableContract (web3, senderAddr) {
  this.web3 = web3;
  this.senderAddr = senderAddr;
}

TableContract.prototype.leave = function(tableAddr, leaveReceipt) {
  var self = this;
  var contract = this.web3.eth.contract(TABLE_ABI).at(tableAddr);
  return new Promise(function (fulfill, reject) {
    contract.leave.sendTransaction(leaveReceipt, {from: self.senderAddr, gas: 200000}, function(err, val){
      if (err) {
        console.log(JSON.stringify(err));
        reject(JSON.stringify(err));
        return;
      }
      fulfill(val);
    });
  });  
}

TableContract.prototype.settle = function(tableAddr, newBalances, sigs) {
  var self = this;
  var contract = this.web3.eth.contract(TABLE_ABI).at(tableAddr);
  return new Promise(function (fulfill, reject) {
    contract.settle.sendTransaction(newBalances, sigs, {from: self.senderAddr, gas: 200000}, function(err, val){
      if (err) {
        console.log(JSON.stringify(err));
        reject(JSON.stringify(err));
        return;
      }
      fulfill(val);
    });
  });  
}

TableContract.prototype.payout = function(tableAddr, signerAddr) {
  var self = this;
  var contract = this.web3.eth.contract(TABLE_ABI).at(tableAddr);
  return new Promise(function (fulfill, reject) {
    contract.payout.sendTransaction(signerAddr, {from: self.senderAddr, gas: 200000}, function(err, val){
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
  var contract = this.web3.eth.contract(TABLE_ABI).at(tableAddr);
  return new Promise(function (fulfill, reject) {
    contract.getLineup.call(function(err, lineup){
      if (err) {
        console.log(JSON.stringify(err));
        reject(err);
        return;
      }
      var rv = [];
      for (var i = 0; i < lineup[1].length; i ++) {
        rv.push({
          address: lineup[1][i],
          amount: lineup[2][i].toNumber()
        });
        if (lineup[3][i] > 0) {
          rv[i].exitHand = lineup[3][i].toNumber();
        }
      }
      fulfill({
        lastHandNetted: lineup[0].toNumber(),
        lineup: rv
      });
    });
  });
}

module.exports = TableContract;