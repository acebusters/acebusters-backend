const ethUtil = require('ethereumjs-util');
const EWT = require('ethereum-web-token');

const sign = function(payload, privStr) {
  const priv = new Buffer(privStr.replace('0x', ''), 'hex');
  const hash = ethUtil.sha3(payload);
  const sig = ethUtil.ecsign(hash, priv);
  return sig.r.toString('hex') + sig.s.toString('hex') + sig.v.toString(16);
}

var EventWorker = function(table, factory, db, oraclePriv) {
  this.table = table;
  this.factory = factory;
  this.db = db;
  if (oraclePriv) {
    this.oraclePriv = oraclePriv;
    const priv = new Buffer(oraclePriv.replace('0x', ''), 'hex');
    this.oracleAddr = '0x' + ethUtil.privateToAddress(priv).toString('hex');
  }
}

EventWorker.prototype.process = function(msg) {

  if (!msg.Subject || msg.Subject.split('::').length < 2 || !msg.Message) {
    return Promise.reject('unknown message type');
  }
  var msgBody;
  try {
    msgBody = JSON.parse(msg.Message)
  } catch(e) {
    return Promise.reject('json parse error: ' + JSON.stringify(e));
  }
  const msgType = msg.Subject.split('::')[0];

  // handle TableLeave event:
  // fordward receipt signed by oracle to table.
  if (msgType === 'TableLeave') {
    return this.table.leave(msgBody.tableAddr, msgBody.leaveReceipt);
  }

  // handle TableNettingRequest:
  // we start preparing the netting in db.
  // create netting, sign by oracle, wait for others
  if (msgType === 'TableNettingRequest') {
    return this.createNetting(msgBody.tableAddr, msgBody.handId);
  }

  // handle TableNettingComplete, when everyone has signed
  // in db, forward netting to settle() function in table.
  if (msgType === 'TableNettingComplete') {
    var sigs = '0x';
    for (var addr in msgBody.netting) {
      if (msgBody.netting.hasOwnProperty(addr) &&
        addr !== 'newBalances') {
        sigs += msgBody.netting[addr].replace('0x', '');
      }
    }
    return this.table.settle(msgBody.tableAddr, msgBody.netting.newBalances, sigs);
  }

  // react to email confirmed. deploy proxy and controller
  // on the chain.
  if (msgType == 'EmailConfirmed') {
    return this.factory.createAccount(msgBody.signerAddr);
  }

  // react to Netting event in table contract:
  // find all players that have lastHand == lastHandNetted
  // pay out those players
  if (msgType == 'ContractEvent' && msgBody.event == 'Netted') {
    return this.payoutPlayers(msgBody.address);
  }

  // TODO: react to hand complete:
  // submit all receipts to table (ideally with a delay)

  // nothing to do
  return Promise.resolve({});
}

EventWorker.prototype.payoutPlayers = function(tableAddr) {
  var self = this;
  return self.table.getLineup(tableAddr).then(function(rsp) {
    const requests = [];
    for (var pos = 0; pos < rsp.lineup.length; pos++) {
      if (rsp.lineup[pos].exitHand <= rsp.lastHandNetted) {
        requests.push(self.table.payout(tableAddr, rsp.lineup[pos].address));
      }
    }
    return Promise.all(requests);
  }).then(function(txns) {
    // do anything more?
    return Promise.resolve(txns);
  });
}

EventWorker.prototype.createNetting = function(tableAddr, handId) {
  var self = this, balances = { [this.oracleAddr]: 0 };
  return self.table.getLineup(tableAddr).then(function(rsp) {
    for (var pos = 0; pos < rsp.lineup.length; pos++) {
      balances[rsp.lineup[pos].address] = rsp.lineup[pos].amount;
    }
    // return get all old hands
    const hands = [];
    for (var i = rsp.lastHandNetted + 1; i <= handId; i ++ )
      hands.push(self.db.getHand(tableAddr, i));
    return Promise.all(hands);
  }).then(function(hands) {
    // sum up previous hands
    for (var i = 0; i < hands.length; i ++) {
      for (var pos = 0; pos < hands[i].lineup.length; pos++) {
        if (hands[i].lineup[pos].last)
          balances[hands[i].lineup[pos].address] -= EWT.parse(hands[i].lineup[pos].last).values[1];
      }
      var dists = EWT.parse(hands[i].distribution).values[2];
      for (var j = 0; j < dists.length; j ++) {
        var dist = EWT.separate(dists[j]);
        balances[dist.address] += dist.amount;
      }
    }
    // build receipt
    const balLength = Object.keys(balances).length;
    const recLength = 28;
    const balBuf = Buffer.alloc(balLength * recLength + 20);
    balBuf.write(tableAddr.replace('0x', ''), 0, 20, 'hex');
    balBuf.writeUInt32BE(handId, 0);
    var i = 0;
    for (var key in balances) {
      if (balances.hasOwnProperty(key)) {
        ethUtil.setLength(balances[key], 8).copy(balBuf, i * recLength + 20);
        balBuf.write(key.replace('0x', ''), i * recLength + 28, 20, 'hex');
        i++;
      }
    }
    // write netting
    return self.db.updateNetting(tableAddr, handId, {
      newBalances: '0x' + balBuf.toString('hex'),
      [self.oracleAddr]: '0x' + sign(balBuf, self.oraclePriv)
    });
  });
}

module.exports = EventWorker;