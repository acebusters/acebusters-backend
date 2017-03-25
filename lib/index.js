const ethUtil = require('ethereumjs-util');
const EWT = require('ethereum-web-token');
const bufferShim = require('buffer-shims');
const crypto = require('crypto');
const PokerHelper = require('poker-helper').PokerHelper;
const Receipt = require('poker-helper').Receipt;
var Solver = require('pokersolver');

const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['c', 'd', 'h', 's'];
const RAKE = 0.01;

const ABI_DIST = [{name: 'distribution', type: 'function', inputs: [{type: 'uint'},{type: 'uint'},{type: 'bytes32[]'}]}];

const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';

const sign = function(payload, privStr) {
  const priv = new Buffer(privStr.replace('0x', ''), 'hex');
  const hash = ethUtil.sha3(payload);
  const sig = ethUtil.ecsign(hash, priv);
  return sig.r.toString('hex') + sig.s.toString('hex') + sig.v.toString(16);
};

const contains = function(needle) {
    // Per spec, the way to identify NaN is that it is not equal to itself
    var findNaN = needle !== needle;
    var indexOf;

    if(!findNaN && typeof Array.prototype.indexOf === 'function') {
        indexOf = Array.prototype.indexOf;
    } else {
        indexOf = function(needle) {
            var i = -1, index = -1;

            for(i = 0; i < this.length; i++) {
                var item = this[i];

                if((findNaN && item !== item) || item === needle) {
                    index = i;
                    break;
                }
            }

            return index;
        };
    }

    return indexOf.call(this, needle) > -1;
};

const err = function(e) {
  console.log(JSON.stringify(e));
  if (err.stack) {
    console.log(err.stack);
  }
  return e;
};

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
    tasks.push(this.submitLeave(msgBody.tableAddr, msgBody.leaveReceipt).catch(err));
  }

  // have the table propress in netting request, for that
  // we send a leave receipt from the oracle
  if (msgType === 'ProgressNettingRequest') {
    tasks.push(this.progressNettingRequest(msg.Subject.split('::')[1], msgBody.handId).catch(err));
  }

  // have the table propress in netting
  // call the net function for that
  if (msgType === 'ProgressNetting') {
    tasks.push(this.progressNetting(msg.Subject.split('::')[1]).catch(err));
  }
  
  // this is where we take all receipt and distributions
  // and send them to the contract to net
  if (msgType === 'HandleDispute') {
    tasks.push(this.handleDispute(msgBody.tableAddr, msgBody.lastHandNetted, msgBody.lastNettingRequest).catch(err));
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

EventWorker.prototype.progressNettingRequest = function(tableAddr, handId) {
  leaveHex = Receipt.leave(tableAddr, handId, this.oracleAddr).signToHex(this.oraclePriv);
  return this.table.leave(tableAddr, leaveHex);
}

EventWorker.prototype.kickPlayer = function(tableAddr, pos) {
  // 1. get last hand
  // 2. check player really overstayed sitout
  // 3. get lineup
  // 4. check player still in lineup
  // 5. make receipt
  // 6. store in lineup
  // 7. send to contract
}

EventWorker.prototype.progressNettingRequest = function(tableAddr, handId) {
  leaveHex = Receipt.leave(tableAddr, handId, this.oracleAddr).signToHex(this.oraclePriv);
  return this.table.leave(tableAddr, leaveHex);
}

EventWorker.prototype.progressNetting = function(tableAddr) {
  return this.table.net(tableAddr);
}

EventWorker.prototype.handleDispute = function(tableAddr, lastHandNetted, lastNettingRequest) {
  const self = this;
  const receipts = [];
  const dists = [];
  const handProms = [];
  var txHash1, betsHex = '0x', betSigs = '0x';
  for (var i = lastHandNetted + 1; i <= lastNettingRequest; i ++ ) {
    handProms.push(self.db.getHand(tableAddr, i));
  }
  return Promise.all(handProms).then(function(hands) {
    var i, pos, distsHex = '0x', distSigs = '0x';
    // sum up previous hands
    for (i = 0; i < hands.length; i ++) {
      for (pos = 0; pos < hands[i].lineup.length; pos++) {
        if (hands[i].lineup[pos].last) {
          receipts.push(hands[i].lineup[pos].last);
        }
      }
      if (hands[i].distribution) {
        dists.push(hands[i].distribution);
      }
    }

    for (i = 0; i < receipts.length; i ++) {
      const parsed = EWT.parseToHex(receipts[i]);
      betsHex += parsed.rec;
      betSigs += parsed.sig;
    }

    for (i = 0; i < dists.length; i ++) {
      const parsed = EWT.parseToHex(dists[i]);
      distsHex += parsed.rec;
      distSigs += parsed.sig;
    }


    return self.table.submitDists(tableAddr, distsHex, distSigs);
  }).then(function(_txHash) {
    txHash1 = _txHash;
    return self.table.submitBets(tableAddr, betsHex, betSigs);
  }).then(function(txHash) {
    return [txHash1, txHash];
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
      if (rsp.lineup[pos].address && rsp.lineup[pos].address !== EMPTY_ADDR) {
        balances[rsp.lineup[pos].address] = rsp.lineup[pos].amount;
      }
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
    // now
    const changed = Math.floor(Date.now() / 1000);
    // handle that seat that we eyed before.
    hand.lineup[joinPos].address = params.lineup[joinPos].address;
    if (hand.state != 'waiting' && hand.state != 'dealing') {
      hand.lineup[joinPos].sitout = changed;
    }
    // if joining player first player, make him dealer
    if (emptyCount >= (hand.lineup.length - 1)) {
      hand.dealer = joinPos;
    }
    // update db
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

EventWorker.prototype.getBalances = function(tableAddr, lineup, lhn, handId) {
  var balances = { [this.oracleAddr]: 0 };
  for (var pos = 0; pos < lineup.length; pos++) {
    balances[lineup[pos].address] = lineup[pos].amount;
  }
  if (lhn >= handId - 1) {
    return Promise.resolve(balances);
  } else {
    const hands = [];
    for (var i = lhn + 1; i < handId; i ++ )
      hands.push(this.db.getHand(tableAddr, i));
    return Promise.all(hands).then(function(hands) {
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
      return Promise.resolve(balances);
    });
  }

}

EventWorker.prototype.calcDistribution = function(tableAddr, hand) {
  if (!hand || !hand.deck || !hand.lineup) {
    return Promise.reject('hand ' + hand + ' at table ' + tableAddr + ' invalid.');
  }
  var self = this, dist, i, j, pots = [], players = [], active, last;
  // create pots
  for (i = 0; i < hand.lineup.length; i++) {
    last = (hand.lineup[i].last) ? EWT.parse(hand.lineup[i].last) : null;
    if (last) {
      active = false;
      if (hand.state === 'showdown') {
        if (last.abi[0].name === 'show' || last.abi[0].name === 'muck') {
          if (!contains.call(pots, last.values[1])) {
            pots.push(last.values[1]);
          }
          active = true;
        }
      } else {
        if (self.helper.isActivePlayer(hand.lineup, i) 
          || hand.lineup[i].sitout === 'allin') {
          if (!contains.call(pots, last.values[1])) {
            pots.push(last.values[1]);
          }
          active = true;
        }
      }
      players.push({
        pos: i,
        active: active,
        amount: last.values[1]
      });
    }
  }
  console.log(JSON.stringify(pots));

  // sort the pots
  pots.sort(function(a, b) {
    return a - b;
  });
  const evals = [];
  for (i = 0; i < pots.length; i++) {
    evals.push({ limit: pots[i], size: 0, chal: [], winners: [] });
  }

  // distribute players on evals
  for (i = 0; i < evals.length; i++) {
    for (j = 0; j < players.length; j++) {
      if (players[j].amount > 0) {
        const contribution = (evals[i].limit > players[j].amount) ? players[j].amount : evals[i].limit;
        evals[i].size += contribution;
        players[j].amount -= contribution;
        if (players[j].active) {
          evals[i].chal.push(players[j].pos);
        }
      }
    }
  }
  console.log(JSON.stringify(evals));

  // solve hands
  const deck = [];
  for (i = 0; i < hand.deck.length; i++) {
    deck[i] = VALUES[ hand.deck[i] % 13 ] + SUITS[ Math.floor( hand.deck[i] / 13)];
  }
  for (i = 0; i < evals.length; i++) {
    const hands = [];
    for (j = 0; j < evals[i].chal.length; j++) {
      const h = [];
      // hole cards
      h.push(deck[evals[i].chal[j] * 2]);
      h.push(deck[evals[i].chal[j] * 2 + 1]);
      // board cards
      h.push(deck[20]);
      h.push(deck[21]);
      h.push(deck[22]);
      h.push(deck[23]);
      h.push(deck[24]);
      hands.push(Solver.Hand.solve(h));
    }
    const wnrs = Solver.Hand.winners(hands);
    for (j = 0; j < wnrs.length; j++) {
      const pos = evals[i].chal[hands.indexOf(wnrs[j])];
      evals[i].winners.push(pos);
    }
  }
  console.log(JSON.stringify(evals));

  // sum up pots by players and calc rake
  const winners = {};
  for (i = 0; i < evals.length; i++) {
    var total = evals[i].size;
    for (j = 0; j < evals[i].winners.length; j++) {
      const addr = hand.lineup[evals[i].winners[j]].address;
      if (!winners[addr]) {
        winners[addr] = 0;
      }
      const share = (evals[i].size - Math.round(evals[i].size * RAKE)) / evals[i].winners.length;
      total -= share;
      winners[addr] += share;
    }
    if (!winners[self.oracleAddr]) {
      winners[self.oracleAddr] = 0;
    }
    winners[self.oracleAddr] += total;
  }
  console.dir(winners);

  //distribute pots
  var dists = [];
  for (var winnerAddr in winners) {
    if (winners.hasOwnProperty(winnerAddr)) {
      dists.push(EWT.concat(winnerAddr, winners[winnerAddr]).toString('hex'));
    }
  }
  var claimId = 0;
  if (hand.distribution) {
    claimId = self.rc.get(hand.distribution).values[1] + 1;
  }
  dist = new EWT(ABI_DIST).distribution(hand.handId, claimId, dists).sign(self.oraclePriv);
  return self.db.updateDistribution(tableAddr, hand.handId, dist).then(function() {
    return Promise.resolve(dist);
  });
}

EventWorker.prototype.putNextHand = function(tableAddr) {
  var self = this, prevHand, lineup, smallBlind, balances;
  const hand = self.db.getLastHand(tableAddr);
  const table = self.table.getLineup(tableAddr);
  const sb = self.table.getSmallBlind(tableAddr);
  return Promise.all([hand, table, sb]).then(function(rsp) {
    prevHand = rsp[0];
    lineup = rsp[1].lineup;
    smallBlind = rsp[2];
    var distProm;
    if (!prevHand.distribution) {
      distProm = self.calcDistribution(tableAddr, prevHand);
    } else {
      distProm = Promise.resolve(prevHand.distribution);
    }
    // return get all old hands
    const balProm = self.getBalances(tableAddr, lineup, rsp[1].lastHandNetted, prevHand.handId);
    return Promise.all([balProm, distProm]);
  }).then(function(rsp) {
    balances = rsp[0];
    prevHand.distribution = rsp[1];
    // sum up previous hands
    for (var pos = 0; pos < prevHand.lineup.length; pos++) {
      if (prevHand.lineup[pos].last)
        balances[prevHand.lineup[pos].address] -= EWT.parse(prevHand.lineup[pos].last).values[1];
    }
    var dists = EWT.parse(prevHand.distribution).values[2];
    for (var j = 0; j < dists.length; j ++) {
      var dist = EWT.separate(dists[j]);
      balances[dist.address] += dist.amount;
    }
    //create new lineup
    for (var i = 0; i < lineup.length; i++) {
      delete lineup[i].amount;
      delete lineup[i].exitHand;
      if (prevHand.lineup[i] && 
        prevHand.lineup[i].address === lineup[i].address) {
        // ignore empty seats
        if (lineup[i].address === EMPTY_ADDR) {
          continue;
        }
        // copy over all sitouts
        if (prevHand.lineup[i].sitout) {
          lineup[i].sitout = prevHand.lineup[i].sitout;
        }
        if (prevHand.lineup[i].last) {
          const receipt = EWT.parse(prevHand.lineup[i].last);
          if (receipt.abi[0].name === 'sitOut') {
            lineup[i].sitout = prevHand.changed;
          }
        }
        // if player broke, put into sitout
        // at timestamp of last hand, so he has some time
        // to rebuy
        if (balances[lineup[i].address] < smallBlind * 2) {
          lineup[i].sitout = prevHand.changed;
        }
      }
    }
    var prevDealer = (typeof prevHand.dealer !== 'undefined') ? (prevHand.dealer + 1): 0;
    const newDealer = self.helper.nextActivePlayer(lineup, prevDealer);
    const deck = shuffle();
    const changed = Math.floor(Date.now() / 1000);
    return self.db.putHand(tableAddr, prevHand.handId + 1, lineup, newDealer, deck, changed);
  }).catch(function(err) {
    if (!err.indexOf || err.indexOf('Not Found') == -1) {
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