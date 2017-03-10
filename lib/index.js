const ethUtil = require('ethereumjs-util');
const EWT = require('ethereum-web-token');
const bufferShim = require('buffer-shims');
const crypto = require('crypto');
const PokerHelper = require('poker-helper').PokerHelper;
const Receipt = require('poker-helper').Receipt;

const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';

const sign = function(payload, privStr) {
  const priv = new Buffer(privStr.replace('0x', ''), 'hex');
  const hash = ethUtil.sha3(payload);
  const sig = ethUtil.ecsign(hash, priv);
  return sig.r.toString('hex') + sig.s.toString('hex') + sig.v.toString(16);
};

const err = function(e) { return e };

const shuffle = function() {
  var array = [];
  for (var i = 0; i < 52; i++)
    array.push(i);
  for (i = array.length - 1; i > 0; i--) {
    var j = crypto.randomBytes(1)[0] % i;
    var temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
  return array;
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
  this.helper = new PokerHelper();
}

EventWorker.prototype.process = function(msg) {
  var tasks = [];

  if (!msg.Subject || msg.Subject.split('::').length < 2) {
    return [Promise.resolve('unknown message type: ' + msg.Subject)];
  }
  var msgBody;
  try {
    msgBody = (msg.Message && msg.Message.length > 0) ? JSON.parse(msg.Message) : '';
  } catch(e) {
    return [Promise.resolve('json parse error: ' + JSON.stringify(e))];
  }
  const msgType = msg.Subject.split('::')[0];

  // handle TableLeave event:
  // fordward receipt signed by oracle to table.
  if (msgType === 'TableLeave') {
    tasks.push(this.submitLeave(msgBody.tableAddr, msgBody.leaveReceipt) );//.catch(err));
  }

  // handle HandComplete event:
  if (msgType === 'HandComplete') {
    tasks.push(this.putNextHand(msg.Subject.split('::')[1]).catch(err));
  }

  // handle TableNettingRequest:
  // we start preparing the netting in db.
  // create netting, sign by oracle, wait for others
  if (msgType === 'TableNettingRequest') {
    tasks.push(this.createNetting(msgBody.tableAddr, msgBody.handId).catch(err));
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
    tasks.push(this.table.settle(msgBody.tableAddr, msgBody.netting.newBalances, sigs).catch(err));
  }

  // react to email confirmed. deploy proxy and controller
  // on the chain.
  if (msgType == 'EmailConfirmed') {
    tasks.push(this.factory.createAccount(msgBody.signerAddr).catch(err));
  }

  // react to Netting event in table contract:
  // find all players that have lastHand == lastHandNetted
  // pay out those players
  if (msgType == 'ContractEvent' && msgBody.event == 'Netted') {
    tasks.push(this.payoutPlayers(msgBody.address).catch(err));
  }

  // react to Join event in table contract:
  // find new player and add to lineup in dynamo
  if (msgType == 'ContractEvent' && msgBody.event == 'Join') {
    tasks.push(this.addPlayer(msgBody.address).catch(err));
  }

  // react to Leave event in table contract:
  // find player and from lineup in dynamo
  if (msgType == 'ContractEvent' && msgBody.event == 'Leave') {
    tasks.push(this.removePlayer(msgBody.address).catch(err));
  }

  // TODO: react to hand complete:
  // submit all receipts to table (ideally with a delay)

  // nothing to do
  return tasks;
}

EventWorker.prototype.submitLeave = function(tableAddr, leaveReceipt) {
  var self = this, leaveHex, leave, txHash;

  try {
    leaveHex = Receipt.parseToHex(leaveReceipt);
    leave = Receipt.parse(leaveReceipt);
  } catch (err) {
    return Promise.reject(err);
  }
  return self.table.leave(tableAddr, leaveHex).then(function(_txHash) {
    txHash = _txHash;
    return self.table.getLineup(tableAddr);
  }).then(function(rsp) {
    if (rsp.lastHandNetted >= leave.handId) {
      return self.table.payout(tableAddr, leave.signerAddr);
    }
    return Promise.resolve('');
  }).then(function(payoutHash) {
    return Promise.resolve([txHash, payoutHash]);
  });
}

EventWorker.prototype.payoutPlayers = function(tableAddr) {
  var self = this;
  return self.table.getLineup(tableAddr).then(function(rsp) {
    const requests = [];
    for (var pos = 0; pos < rsp.lineup.length; pos++) {
      if (rsp.lineup[pos].exitHand > 0 && 
        rsp.lineup[pos].exitHand <= rsp.lastHandNetted) {
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
    const balBuf = bufferShim.alloc(balLength * recLength + 20);
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

EventWorker.prototype.addPlayer = function(tableAddr) {
  var self = this, hand;
  const lup = self.table.getLineup(tableAddr);
  const ddp = self.db.getLastHand(tableAddr);
  return Promise.all([lup, ddp]).then(function(responses) {
    hand = responses[1];
    params = responses[0];
    if (params.lastHandNetted > hand.handId)
      return Promise.reject('contract handId ' + params.lastHandNetted + ' ahead of table handId ' + hand.handId);
    if (!hand.lineup || hand.lineup.length != params.lineup.length)
      return Promise.reject('table lineup length ' + hand.lineup.length + ' does not match contract.');
    var joinPos = -1;
    var emptyCount = 0;
    for (var i = 0; i < hand.lineup.length; i ++) {
      // if seat empty in table
      if (!hand.lineup[i].address || 
        hand.lineup[i].address === EMPTY_ADDR) {
        emptyCount += 1;
        // but filled in contract
        if (params.lineup[i].address &&
          params.lineup[i].address !== EMPTY_ADDR) {
          // remember that seat to work on it
          joinPos = i;
        }
      }
    }
    if (joinPos === -1)
      return Promise.reject('no new player found in lineup after join event.');
    // handle that seat that we eyed before.
    hand.lineup[joinPos].address = params.lineup[joinPos].address;
    if (hand.state != 'waiting' && hand.state != 'dealing') {
      hand.lineup[joinPos].sitout = true;
    }
    // if joining player first player, make him dealer
    if (emptyCount >= (hand.lineup.length - 1)) {
      hand.dealer = joinPos;
    }
    // update db
    const changed = Math.floor(Date.now() / 1000);
    return self.db.updateSeat(tableAddr, hand.handId, hand.lineup[joinPos], joinPos, changed, hand.dealer);
  });
}

EventWorker.prototype.removePlayer = function(tableAddr) {
  var self = this, hand;
  const lup = self.table.getLineup(tableAddr);
  const ddp = self.db.getLastHand(tableAddr);
  return Promise.all([lup, ddp]).then(function(responses) {
    hand = responses[1];
    params = responses[0];
    if (params.lastHandNetted > hand.handId)
      return Promise.reject('contract handId ' + params.lastHandNetted + ' ahead of table handId ' + hand.handId);
    if (!hand.lineup || hand.lineup.length != params.lineup.length)
      return Promise.reject('table lineup length ' + hand.lineup.length + ' does not match contract.');
    var leavePos = -1;
    for (var i = 0; i < hand.lineup.length; i ++) {
      // if seat is taken in table
      if (hand.lineup[i].address && 
        hand.lineup[i].address !== EMPTY_ADDR) {
        // but empty in contract
        if (!params.lineup[i].address ||
          params.lineup[i].address === EMPTY_ADDR) {
          // remember that seat to work on it
          leavePos = i;
          break;
        }
      }
    }
    if (leavePos === -1)
      return Promise.reject('no left player found in lineup after Leave event.');
    // handle that seat that we eyed before.
    hand.lineup[leavePos] = { address: params.lineup[leavePos].address };
    // update db
    const changed = Math.floor(Date.now() / 1000);
    return self.db.updateSeat(tableAddr, hand.handId, hand.lineup[leavePos], leavePos, changed, hand.dealer);
  });
}

EventWorker.prototype.putFirstHand = function(tableAddr) {
  const self = this;
  return self.table.getLineup(tableAddr).then(function(rsp) {
    const lineup = rsp.lineup;
    for (var i = 0; i < lineup.length; i++) {
      delete lineup[i].amount;
      delete lineup[i].exitHand;
    }
    const deck = shuffle();
    const changed = Math.floor(Date.now() / 1000);
    return self.db.putHand(tableAddr, 1, lineup, 0, deck, changed);
  });
}

EventWorker.prototype.putNextHand = function(tableAddr) {
  var self = this, prevHand;
  return self.db.getLastHand(tableAddr).then(function(_prevHand) {
    prevHand = _prevHand;
    if (!prevHand.distribution)
      return Promise.reject('Bad Request: previous hand ' + prevHand.handId + ' still playing.');

    return self.table.getLineup(tableAddr);
  }).then(function(rsp) {
    var lineup = rsp.lineup;
    for (var i = 0; i < lineup.length; i++) {
      delete lineup[i].amount;
      delete lineup[i].exitHand;
      if (prevHand.lineup[i] && 
        prevHand.lineup[i].address === lineup.address) {
        // copy over all sitouts
        if (prevHand.lineup[i].sitout) {
          lineup[i].sitout = true;
        }
        if (prevHand.lineup[i].last) {
          const receipt = EWT.parse(prevHand.lineup[i].last);
          if (receipt.abi[0].name == 'sitOut') {
            lineup[i].sitout = true;
          }
        }
      }
    }
    var prevDealer = (typeof prevHand.dealer !== 'undefined') ? (prevHand.dealer + 1): 0;
    var newDealer = self.helper.nextActivePlayer(lineup, prevDealer);
    const deck = shuffle();
    const changed = Math.floor(Date.now() / 1000);
    return self.db.putHand(tableAddr, prevHand.handId + 1, lineup, newDealer, deck, changed);
  }).catch(function(err) {
    if (err.indexOf('Not Found') == -1) {
      throw err;
    }
    return self.table.getLineup(tableAddr).then(function(rsp) {
      const lineup = rsp.lineup;
      for (var i = 0; i < lineup.length; i++) {
        delete lineup[i].amount;
        delete lineup[i].exitHand;
      }
      const deck = shuffle();
      const changed = Math.floor(Date.now() / 1000);
      return self.db.putHand(tableAddr, rsp.lastHandNetted + 1, lineup, 0, deck, changed);
    });
  });
}

module.exports = EventWorker;