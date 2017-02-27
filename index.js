var AWS = require('aws-sdk');
const StreamWorker = require('./lib/index');
const Provider = require('./lib/provider');
const Table = require('./lib/tableContract');

const TABLE_ABI = [{"constant":false,"inputs":[{"name":"_leaveReceipt","type":"bytes"}],"name":"leave","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"","type":"uint256"}],"name":"seats","outputs":[{"name":"senderAddr","type":"address"},{"name":"amount","type":"uint96"},{"name":"signerAddr","type":"address"},{"name":"lastHand","type":"uint96"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"lastNettingRequestTime","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"lastHandNetted","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_sender","type":"address"}],"name":"payoutFrom","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_newBalances","type":"bytes"},{"name":"_sigs","type":"bytes"}],"name":"settle","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[],"name":"payout","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_now","type":"uint256"}],"name":"netHelp","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"oracle","outputs":[{"name":"","type":"address"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"","type":"uint256"}],"name":"hands","outputs":[{"name":"claimCount","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_buyIn","type":"uint96"},{"name":"_signerAddr","type":"address"},{"name":"_pos","type":"uint256"}],"name":"join","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"getLineup","outputs":[{"name":"","type":"uint256"},{"name":"addr","type":"address[]"},{"name":"amount","type":"uint256[]"},{"name":"lastHand","type":"uint96[]"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_bets","type":"bytes"},{"name":"_sigs","type":"bytes"}],"name":"submitBets","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"lastNettingRequestHandId","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[],"name":"net","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"}],"name":"seatMap","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_handId","type":"uint96"},{"name":"_addr","type":"address"}],"name":"getIn","outputs":[{"name":"","type":"uint96"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"smallBlind","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_handId","type":"uint96"},{"name":"_addr","type":"address"}],"name":"getOut","outputs":[{"name":"","type":"uint96"},{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_dists","type":"bytes"},{"name":"_sigs","type":"bytes"}],"name":"submitDists","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"token","outputs":[{"name":"","type":"address"}],"payable":false,"type":"function"},{"inputs":[{"name":"_token","type":"address"},{"name":"_oracle","type":"address"},{"name":"_smallBlind","type":"uint256"},{"name":"_seats","type":"uint256"}],"payable":false,"type":"constructor"},{"anonymous":false,"inputs":[{"indexed":false,"name":"addr","type":"address"},{"indexed":false,"name":"amount","type":"uint256"}],"name":"Join","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"hand","type":"uint256"}],"name":"NettingRequest","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"hand","type":"uint256"}],"name":"Netted","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"errorCode","type":"uint256"}],"name":"Error","type":"event"}];

var web3Provider;

exports.handler = function(event, context, callback) {

  if (event.Records && event.Records instanceof Array) {

    if (!web3Provider) {
      var web3 = new Web3();
      web3Provider = new web3.providers.HttpProvider(process.env.providerUrl);
    }
    var provider = new Provider(web3Provider, process.env.accountAddr, TABLE_ABI);

    var requests = [];
    var worker = new StreamWorker(new Table(provider));
    for (var i = 0; i < event.Records.length; i++) {
      requests.push(worker.process(event.Records[i]));
    }
    Promise.all(requests).then(function(data) {
      callback(null, data);
    }).catch(function(err) {
      console.log(JSON.stringify(err));
      console.log(err.stack);
      callback(err);
    });
  } else {
    console.log('Request received:\n', JSON.stringify(event));
    console.log('Context received:\n', JSON.stringify(context));
  }
}