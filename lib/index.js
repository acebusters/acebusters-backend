const EWT = require('ethereum-web-token');
const ethUtil = require('ethereumjs-util');
const PokerHelper = require('poker-helper').PokerHelper;
const Receipt = require('poker-helper').Receipt;

var TableManager = function(db, contract, receiptCache, oraclePriv) {
  this.db = db;
  this.rc = receiptCache;
  this.helper = new PokerHelper(this.rc);
  this.contract = contract;
  if (oraclePriv) {
    this.oraclePriv = oraclePriv;
    const priv = new Buffer(oraclePriv.replace('0x', ''), 'hex');
    this.oracleAddr = '0x' + ethUtil.privateToAddress(priv).toString('hex');
  }
}

TableManager.prototype.getConfig = function(stageVars) {
  return Promise.resolve({
    tableContracts: stageVars.tableContracts.split(','),
    providerUrl: stageVars.providerUrl
  });
}

TableManager.prototype.info = function(tableAddr, tableContracts) {
  var self = this;
  return this.db.getLastHand(tableAddr).then(function(hand) {
    if (hand.state == 'showdown') {
      for (var i = 0; i < hand.lineup.length; i++) {
        if (hand.lineup[i].last) {
          var last = self.rc.get(hand.lineup[i].last);
          if (last.abi[0].name == 'show') {
            hand.lineup[i].cards = [];
            hand.lineup[i].cards.push(hand.deck[i * 2]);
            hand.lineup[i].cards.push(hand.deck[i * 2 + 1]);
          }
        }
      }
    }
    var rv = {
      handId: hand.handId,
      lineup: hand.lineup,
      dealer: hand.dealer,
      state: hand.state,
      changed: hand.changed,
      cards: []
    }
    if (hand.state == 'flop') {
      rv.cards.push(hand.deck[20]);
      rv.cards.push(hand.deck[21]);
      rv.cards.push(hand.deck[22]);
    }
    if (hand.state == 'turn') {
      rv.cards.push(hand.deck[20]);
      rv.cards.push(hand.deck[21]);
      rv.cards.push(hand.deck[22]);
      rv.cards.push(hand.deck[23]);
    }
    if (hand.state == 'river' || hand.state == 'showdown') {
      rv.cards.push(hand.deck[20]);
      rv.cards.push(hand.deck[21]);
      rv.cards.push(hand.deck[22]);
      rv.cards.push(hand.deck[23]);
      rv.cards.push(hand.deck[24]);
    }
    if (hand.distribution)
      rv.distribution = hand.distribution;
    if (hand.netting)
      rv.netting = hand.netting;
    return Promise.resolve(rv);
  }, function(err) {
    var tables = [];
    if (tableContracts) {
      tables = tableContracts.split(',');
    }
    if (err.indexOf('Not Found: table with') > -1 && 
      tables.indexOf(tableAddr) > -1) {
      return Promise.resolve({
        handId: 0,
        dealer: 0,
        state: 'showdown',
        distribution: '0x1234'
      });
    } else {
      throw err;
    }
  });
}

TableManager.prototype.hand = function(tableAddr, handId) {
  var self = this;
  return this.db.getHand(tableAddr, parseInt(handId)).then(function(hand) {
    var rv = {
      handId: hand.handId,
      lineup: hand.lineup,
      dealer: hand.dealer,
      state: hand.state,
      distribution: hand.distribution
    }
    if (hand.netting)
      rv.netting = hand.netting;
    return Promise.resolve(rv);
  });
}

TableManager.prototype.pay = function(tableAddr, ewt) {
  const self = this;
  const receipt = this.rc.get(ewt);
  const handId = receipt.values[0];
  var hand, turn, dist, deck, prevReceipt, pos = -1;
  return this.db.getLastHand(tableAddr).then(function(_hand) {
    hand = _hand;
    deck = _hand.deck;
    if (hand.handId !== handId)
      return Promise.reject('Bad Request: unknown handId ' + handId + ', currently playing ' + hand.handId);
    // check hand not finished yet
    if (hand.distribution !== undefined)
      return Promise.reject('Bad Request: hand ' + hand.handId + ' has distribution already.');
    // are we ready to start dealing
    if (hand.state === 'waiting' && self.helper.activePlayersLeft(hand) < 2)
      return Promise.reject('Bad Request: not enough players to start game.');
    // check signer in lineup
    pos = self.helper.inLineup(receipt.signer, hand.lineup);
    if (pos < 0)
      return Promise.reject('Forbidden: address ' + receipt.signer + ' not in lineup.');
    //check signer not leaving
    if (hand.lineup[pos].lastHand && hand.lineup[pos].lastHand < hand.handId)
      return Promise.reject('Forbidden: lastHand ' + hand.lineup[pos].lastHand + ' exceeded.');
    //check ewt not reused
    if (hand.lineup[pos].last == ewt)
      return Promise.reject('Unauthorized: you can not reuse receipts.');

    //check bet not too small
    var max = self.helper.findMaxBet(hand.lineup);
    if (hand.state != 'dealing' && receipt.abi[0].name == 'bet' && receipt.values[1] < max.amount)
      return Promise.reject('Unauthorized: you have to match or raise ' + max.amount);

    //make sure to replace receipts in right order
    if (hand.lineup[pos].last) {
      prevReceipt = self.rc.get(hand.lineup[pos].last);
      if (prevReceipt.abi[0].name == 'fold')
        return Promise.reject('Bad Request: no bet after fold.');

      if (prevReceipt.abi[0].name == 'sitOut' && hand.state != 'dealing')
        return Promise.reject('Bad Request: leave sitout only during dealing.');

      if (receipt.abi[0].name.indexOf('check') > -1 && receipt.values[1] != prevReceipt.values[1]) {
        return Promise.reject('Bad Request: check should not raise.');
      }
    }

    if (receipt.abi[0].name == 'check' && hand.state != 'preflop')
      return Promise.reject('Bad Request: check only during preflop.');

    if (receipt.abi[0].name == 'checkFlop' && hand.state != 'flop')
      return Promise.reject('Bad Request: checkFlop only during flop.');

    if (receipt.abi[0].name == 'checkTurn' && hand.state != 'turn')
      return Promise.reject('Bad Request: checkTurn only during turn.');

    if (receipt.abi[0].name == 'checkRiver' && hand.state != 'river')
      return Promise.reject('Bad Request: checkRiver only during river.');

    max.amount = (receipt.values[1] > max.amount) ? receipt.values[1] : max.amount;
    turn = self.helper.isMyTurn({lineup: hand.lineup, dealer: hand.dealer}, pos);
    if (hand.state == 'waiting') {
      if (!turn)
        return Promise.reject('Bad Request: not your turn to pay small blind.');
      var lineup = self.contract.getLineup(tableAddr);
      var params = self.contract.getParams(tableAddr);
      return Promise.all([lineup, params]);
    } else {
      return Promise.resolve([]);
    }
  }).then(function(vals) {
    if (hand.state == 'waiting') {
      var lineup = vals[0].lineup, 
          params = vals[1];
      for (var i = 0; i < lineup.length; i++) {
        if (receipt.signer == lineup[i].address)
          pos = i;
        delete lineup[i].amount;
      }
      if (pos < 0) {
        return Promise.reject('Forbidden: address ' + receipt.signer + ' not in lineup.');
      }
      //check if receipt is small blind?
      if (receipt.values[1] !== params.bigBlind / 2) {
        return Promise.reject('Bad Request: small blind not valid.');
      }
    }
    if (hand.state == 'dealing') {
      //check if receipt is big blind?
      if (turn && receipt.abi[0].name == 'bet') {
        var smallBlindPos = self.helper.nextActivePlayer(hand.lineup, (hand.lineup.length > 2) ? hand.dealer + 1 : hand.dealer);

        var bigBlindPos = self.helper.nextActivePlayer(hand.lineup, smallBlindPos + 1);
        if (self.helper.whosTurn(hand) == bigBlindPos) {
          var smallBlind = hand.lineup[smallBlindPos].last;
          var sb = self.rc.get(smallBlind);
          if (receipt.values[1] != sb.values[1] * 2)
            return Promise.reject('Bad Request: big blind not valid.');
        }
      }
    }

    if ( (prevReceipt && prevReceipt.values[1] < receipt.values[1]) || !prevReceipt && receipt.values[1] > 0) {
      //calc bal
      return self.calcBalance(tableAddr, pos, receipt).then(function(balLeft) {
        hand.lineup[pos].last = ewt;
        if (balLeft === 0) {
          hand.lineup[pos].sitout = 'allin';
        }
        return self.updateState(tableAddr, hand, pos);
      });
    } else {
      hand.lineup[pos].last = ewt;
      return self.updateState(tableAddr, hand, pos);
    }
  }).then(function(){
    var rsp = (deck) ? { cards: [deck[pos * 2], deck[pos * 2 + 1]] } : {};
    rsp = (dist) ? {distribution: dist} : rsp;
    return Promise.resolve(rsp);
  });
}

TableManager.prototype.updateState = function(tableAddr, hand, pos) {
    const changed = Math.floor(Date.now() / 1000);
    const max = this.helper.findMaxBet(hand.lineup);
    const bettingComplete = this.helper.allDone(hand.lineup, hand.dealer, hand.state, max.amount);
    const handComplete = this.helper.checkForNextHand(hand);
    if (bettingComplete && !handComplete) {
      if (hand.state == 'river')
        hand.state = 'showdown';
      if (hand.state == 'turn')
        hand.state = 'river';
      if (hand.state == 'flop')
        hand.state = 'turn';
      if (hand.state == 'preflop')
        hand.state = 'flop';
      if (hand.state == 'dealing')
        hand.state = 'preflop';
    }
    if (hand.state == 'waiting')
      hand.state = 'dealing';

    // take care of all-in
    const activePlayerCount = this.helper.activePlayersLeft(hand);
    const allInPlayerCount = this.helper.countAllIns(hand);
    if (bettingComplete && activePlayerCount === 1 && allInPlayerCount > 0) {
      hand.state = 'showdown';
    }
    // update db
    return this.db.updateSeat(tableAddr, hand.handId, hand.lineup[pos], pos, hand.state, changed);
}

TableManager.prototype.calcBalance = function(tableAddr, pos, receipt) {
  var self = this, amount;
  if (receipt.values[1] > 0) {
    //check if balance sufficient
    //1. get balance at last netted
    //2. go hand by hand till current hand - 1
      // substract all bets
      // add all winnings
    //3. check if amount - bet > 0
    return self.contract.getLineup(tableAddr).then(function(rsp) {
      amount = rsp.lineup[pos].amount.toNumber();
      //return get all old hands
      var hands = [];
      for (var i = rsp.lastHandNetted.toNumber() + 1; i < receipt.values[0]; i ++ )
        hands.push(self.db.getHand(tableAddr, i));
      return Promise.all(hands);
    }).then(function(hands) {
      for (var i = 0; i < hands.length; i ++) {
        if (hands[i].lineup[pos].last)
          amount -= self.rc.get(hands[i].lineup[pos].last).values[1];
        var dists = self.rc.get(hands[i].distribution).values[2];
        for (var j = 0; j < dists.length; j ++) {
          var dist = EWT.separate(dists[j]);
          if (dist.address == receipt.signer)
            amount += dist.amount;
        }
      }
      const balLeft = amount - receipt.values[1];
      if (balLeft >= 0)
        return Promise.resolve(balLeft);
      else {
        return Promise.reject('Forbidden: can not bet more than balance (' + amount + ').');
      }
    }, function(err) {
      return Promise.reject(err);
    });
  } else {
    return Promise.resolve();
  }
}

TableManager.prototype.show = function(tableAddr, ewt, cards) {
  if (!cards || Object.prototype.toString.call(cards) !== '[object Array]' || cards.length !== 2)
    return Promise.reject('Bad Request: cards should be submitted as array.');
  var self = this, hand, deck, dist, pos = -1, receipt = this.rc.get(ewt);
  // check receipt type
  if (receipt.abi[0].name != 'show' && receipt.abi[0].name != 'muck')
    return Promise.reject('Bad Request: only "show" and "muck" receipts permitted in showdown.');
  var handId = receipt.values[0];
  //check if this hand exists
  return this.db.getHand(tableAddr, handId).then(function(_hand) {
    hand = _hand;
    deck = _hand.deck;
    if (hand.state != 'showdown')
      return Promise.reject('Bad Request: hand ' + handId + ' not in showdown.');
    pos = self.helper.inLineup(receipt.signer, hand.lineup);
    if (pos < 0)
      return Promise.reject('Forbidden: address ' + receipt.signer + ' not in lineup.');
    // check user allow to participate in showdown
    if (hand.lineup[pos].sitout && hand.lineup[pos].sitout.indexOf('allin') < 0) {
      return Promise.reject('Forbidden: seat ' + pos + ' in sitout, not allowed in showdown.');
    }
    prevReceipt = self.rc.get(hand.lineup[pos].last)
    if (prevReceipt.abi[0].name.indexOf('bet') < 0) {
      return Promise.reject('Forbidden: seat ' + pos + ' last receipt not bet, not allowed in showdown.');
    }
    // check ewt not reused
    if (hand.lineup[pos].last == ewt)
      return Promise.reject('Unauthorized: you can not reuse receipts.');
    // check cards
    if (cards[0] != deck[pos * 2] || cards[1] != deck[pos * 2 + 1])
      return Promise.reject('Bad Request: you submitted wrong cards.');

    // set the new data
    hand.lineup[pos].last = ewt;
    if (receipt.abi[0].name == 'show')
      hand.lineup[pos].cards = cards;
    //update db
    const changed = Math.floor(Date.now() / 1000);
    return self.db.updateSeat(tableAddr, hand.handId, hand.lineup[pos], pos, hand.state, changed);
  }).then(function() {
    return Promise.resolve(dist);
  });
}

TableManager.prototype.leave = function(tableAddr, ewt) {
  var self = this, hand, pos = -1, leaveReceipt
    receipt = this.rc.get(ewt);
  var handId = receipt.values[0];
  // check if this hand exists
  return this.db.getLastHand(tableAddr).then(function(_hand) {
    hand = _hand;
    if (hand.state == 'waiting') {
      if (handId < hand.handId - 1)
        return Promise.reject('Bad Request: forbidden to exit at handId ' + handId);
    } else {
      if (handId < hand.handId)
        return Promise.reject('Bad Request: forbidden to exit at handId ' + handId);
    }
    // check signer in lineup
    return self.contract.getLineup(tableAddr);
  }).then(function(rsp) {
    for (var i = 0; i < rsp.lineup.length; i++) {
      if (receipt.signer == rsp.lineup[i].address) {
        pos = i;
        break;
      }
    }
    if (pos < 0)
      return Promise.reject('Forbidden: address ' + receipt.signer + ' not in lineup.');
    // check signer not submitting another leave receipt
    if (hand.lineup[pos] && hand.lineup[pos].lastHand)
      return Promise.reject('Forbidden: lastHand ' + hand.lineup[pos].lastHand + ' already set.');
    leaveReceipt = Receipt.leave(tableAddr, handId, receipt.signer).sign(self.oraclePriv);
    // put leave receipt into lineup and set lastHand
    if (!hand.lineup[pos]) {
      hand.lineup[pos] = {};
    }
    hand.lineup[pos].leaveReceipt = leaveReceipt;
    hand.lineup[pos].lastHand = receipt.values[0];
    if (receipt.values[0] < hand.handId) {
      hand.lineup[pos].sitout = 'leave';
    }
    return self.db.updateLeave(tableAddr, hand.handId, hand.lineup[pos], pos);
  }).then(function() {
    // return leave receipt
    return Promise.resolve({ leaveReceipt });
  });
}

TableManager.prototype.netting = function(tableAddr, handId, nettingSig) {
  var self = this;
  return this.db.getHand(tableAddr, parseInt(handId)).then(function(hand) {
    if (nettingSig === undefined || 
      nettingSig.length < 130 || 
      nettingSig.length > 132) {
      return Promise.reject('Bad Request: nettingSig ' + nettingSig + ' invalid.');
    }
    if (hand.netting === undefined) {
      return Promise.reject('Bad Request: hand ' + handId + ' has no netting.');
    }
    // do ecrecover
    const netSigHex = nettingSig.replace('0x', '');
    const r = new Buffer(netSigHex.substring(0, 64), 'hex');
    const s = new Buffer(netSigHex.substring(64, 128), 'hex');
    const v = parseInt(netSigHex.substring(128, 130), 16);
    const payload = new Buffer(hand.netting.newBalances.replace('0x', ''), 'hex');
    const hash = ethUtil.sha3(payload);
    const pub = ethUtil.ecrecover(hash, v, r, s);
    const signer = '0x' + ethUtil.pubToAddress(pub).toString('hex');
    if (hand.netting[signer] !== undefined) {
      return Promise.reject('Conflict: signer ' + signer + ' already delivered nettingSig.');
    }
    var isSignerInLineup = false;
    for (var i = 0; i < hand.lineup.length; i++) {
      if (hand.lineup[i].address == signer) {
        isSignerInLineup = true;
        break;
      }
    }
    if (!isSignerInLineup) {
      return Promise.reject('Not Found: signer ' + signer + ' not in lineup.');
    }
    return self.db.updateNetting(tableAddr, parseInt(handId), signer, nettingSig);
  });
}

TableManager.prototype.timeout = function(tableAddr) {
  const self = this;
  var hand, pos = -1;
  // get the latest hand to check on
  return this.db.getLastHand(tableAddr).then(function(_hand) {
    hand = _hand;
    pos = self.helper.whosTurn(hand);
    if (pos == -1) {
      return Promise.reject('Bad Request: could not find next player to act in hand ' + hand.handId);
    }
    const leftTime = (hand.changed + 60) - Math.floor(Date.now() / 1000);
    if (leftTime > 0) {
      return Promise.reject('Bad Request: player ' + pos + ' still got ' + leftTime + ' second to act.');
    }
    hand.lineup[pos].sitout = 'timeout';
    return self.updateState(tableAddr, hand, pos);
  });
}

module.exports = TableManager;