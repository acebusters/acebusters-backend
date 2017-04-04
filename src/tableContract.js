const tableAbi = [{"constant":false,"inputs":[{"name":"_leaveReceipt","type":"bytes"}],"name":"leave","outputs":[{"name":"","type":"address"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_handId","type":"uint256"},{"name":"_addr","type":"address"}],"name":"getOut","outputs":[{"name":"","type":"uint96"},{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"","type":"uint256"}],"name":"seats","outputs":[{"name":"addr","type":"address"},{"name":"amount","type":"uint96"},{"name":"lastHand","type":"uint256"},{"name":"conn","type":"bytes32"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"lastNettingRequestTime","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"lastHandNetted","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_sender","type":"address"}],"name":"payoutFrom","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_newBalances","type":"bytes"},{"name":"_sigs","type":"bytes"}],"name":"settle","outputs":[{"name":"","type":"bool"}],"payable":false,"type":"function"},{"constant":false,"inputs":[],"name":"payout","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_now","type":"uint256"}],"name":"netHelp","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"oracle","outputs":[{"name":"","type":"address"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_buyIn","type":"uint96"},{"name":"_conn","type":"bytes32"}],"name":"join","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_handId","type":"uint256"},{"name":"_addr","type":"address"}],"name":"getIn","outputs":[{"name":"","type":"uint96"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"getLineup","outputs":[{"name":"","type":"uint256"},{"name":"addr","type":"address[]"},{"name":"amount","type":"uint256[]"},{"name":"exitHand","type":"uint256[]"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_bets","type":"bytes"},{"name":"_sigs","type":"bytes"}],"name":"submitBets","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"lastNettingRequestHandId","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[],"name":"net","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"smallBlind","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_dists","type":"bytes"},{"name":"_sigs","type":"bytes"}],"name":"submitDists","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"inputs":[{"name":"_token","type":"address"},{"name":"_oracle","type":"address"},{"name":"_smallBlind","type":"uint256"},{"name":"_seats","type":"uint256"}],"payable":false,"type":"constructor"},{"anonymous":false,"inputs":[{"indexed":false,"name":"addr","type":"address"},{"indexed":false,"name":"conn","type":"bytes32"},{"indexed":false,"name":"amount","type":"uint256"}],"name":"Join","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"hand","type":"uint256"}],"name":"NettingRequest","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"hand","type":"uint256"}],"name":"Netted","type":"event"}];

function TableContract (web3) {
  this.web3 = web3;
}

TableContract.prototype.getLineup = function(tableAddr) {
  var self = this;
  var contract = this.web3.eth.contract(tableAbi).at(tableAddr);
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
