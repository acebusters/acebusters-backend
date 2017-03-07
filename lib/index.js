const EWT = require('ethereum-web-token');
const ethUtil = require('ethereumjs-util');
var Solver = require('pokersolver');
var PokerHelper = require('poker-helper').PokerHelper;

const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['c', 'd', 'h', 's'];
const RAKE = 0.01;
//secretSeed: 'erode melody nature bounce sample deny spend give craft alcohol supply roof' }
const RAKE_ADDR = '0x82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f';
const RAKE_KEY = '0x94890218f2b0d04296f30aeafd13655eba4c5bbf1770273276fee52cbe3f2cb4';

const ABI_DIST = [{name: 'distribution', type: 'function', inputs: [{type: 'uint'},{type: 'uint'},{type: 'bytes32[]'}]}];


var TableManager = function(db, contract, receiptCache) {
  this.db = db;
  this.rc = receiptCache;
  this.helper = new PokerHelper(this.rc);
  this.contract = contract;
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
        var last = self.rc.get(hand.lineup[i].last);
        if (last.abi[0].name == 'show') {
          hand.lineup[i].cards = [];
          hand.lineup[i].cards.push(hand.deck[i * 2]);
          hand.lineup[i].cards.push(hand.deck[i * 2 + 1]);
        }
      }
    }
    var rv = {
      handId: hand.handId,
      lineup: hand.lineup,
      dealer: hand.dealer,
      state: hand.state,
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
      distribution: hand.distribution,
      netting: hand.netting
    }
      
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
      if (pos < 0)
        return Promise.reject('Forbidden: address ' + receipt.signer + ' not in lineup.');
      //check if receipt is small blind?
      if (receipt.values[1] != params.bigBlind / 2)
        return Promise.reject('Bad Request: small blind not valid.');
    }
    if (hand.state == 'dealing') {
      //check if receipt is big blind?
      if (turn) {
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
    if (receipt.abi[0].name == 'fold' &&
      self.helper.activePlayersLeft(hand) < 3) {
      var pot = 0;
      for (i = 0; i < hand.lineup.length; i++) {
        var last = self.rc.get(hand.lineup[i].last);
        pot += (last) ? last.values[1] : 0;
      }
      var winPos = self.helper.nextActivePlayer(hand.lineup, hand.dealer);
      var dists = [];
      dists.push(EWT.concat(RAKE_ADDR, Math.round( pot * RAKE)).toString('hex'));
      dists.push(EWT.concat(hand.lineup[winPos].address, Math.round(pot - (pot * RAKE))).toString('hex'));
      dist = new EWT(ABI_DIST).distribution(hand.handId, 0, dists).sign(RAKE_KEY);
      hand.lineup[pos].last = ewt;
      return self.db.updateHandDist(tableAddr, hand.handId, dist, hand.lineup);
    }

    if ( (prevReceipt && prevReceipt.values[1] < receipt.values[1]) || !prevReceipt && receipt.values[1] > 0) {
      //calc bal
      return self.calcBalance(tableAddr, pos, receipt).then(function() {
        hand.lineup[pos].last = ewt;
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
    hand.lineup[pos].time = Math.floor(Date.now() / 1000);
    var max = this.helper.findMaxBet(hand.lineup);
    if (this.helper.allDone(hand.lineup, hand.dealer, hand.state, max.amount)) {
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
    //update db
    return this.db.updateHand(tableAddr, hand.handId, hand.lineup, hand.state, pos);
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
      if ((amount - receipt.values[1]) > 0)
        return Promise.resolve();
      else {
        return Promise.reject('Forbidden: can not bet more than balance (' + amount / 100 + ').');
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
    //check ewt not reused
    if (hand.lineup[pos].last == ewt)
      return Promise.reject('Unauthorized: you can not reuse receipts.');
    if (cards[0] != deck[pos * 2] || cards[1] != deck[pos * 2 + 1])
      return Promise.reject('Bad Request: you submitted wrong cards.');
    if (receipt.abi[0].name != 'show' && receipt.abi[0].name != 'muck')
      return Promise.reject('Bad Request: only "show" and "muck" receipts permitted in showdown.');

    //set the new data
    hand.lineup[pos].last = ewt;
    if (receipt.abi[0].name == 'show')
      hand.lineup[pos].cards = cards;

    //create hands
    var i, j, hands = [], pots = [];
    for (i = 0; i < hand.lineup.length; i++) {
      var h = [];
      if (hand.lineup[i].cards) {
        h.push(deck[i * 2]);
        h.push(deck[i * 2 + 1]);
      }
      h.push(hand.deck[20]);
      h.push(hand.deck[21]);
      h.push(hand.deck[22]);
      h.push(hand.deck[23]);
      h.push(hand.deck[24]);
      hands.push(h);
      if (pots.length == 0)
        pots.push(0);
      var last = self.rc.get(hand.lineup[i].last);
      pots[0] += last.values[1];
    }

    //convert to string representation
    for (i = 0; i < hands.length; i++) {
      for (j = 0; j < hands[i].length; j++) {
        hands[i][j] = VALUES[ hands[i][j] % 13 ] + SUITS[ Math.floor( hands[i][j] / 13)];
      }
    }

    //solve with pokersolver
    for (i = 0; i < hands.length; i++) {
      hands[i] = Solver.Hand.solve(hands[i]);
    }
    var winners = Solver.Hand.winners(hands);
    //distribute pots
    var dists = [];
    dists.push(EWT.concat(RAKE_ADDR, Math.round(pots[0] * RAKE)).toString('hex'));
    for (i = 0; i < hand.lineup.length; i++) {
      for (j = 0; j < winners.length; j++) {
        if (hands[i] == winners[j]) {
          dists.push(EWT.concat(hand.lineup[i].address, Math.round((pots[0] - (pots[0] * RAKE)) / (winners.length))).toString('hex'));
        }
      }
    }
    var claimId = 0;
    if (hand.distribution) {
      claimId = self.rc.get(hand.distribution).values[1] + 1;
    }
    dist = new EWT(ABI_DIST).distribution(handId, claimId, dists).sign(RAKE_KEY);
    return self.db.updateHandDist(tableAddr, handId, dist, hand.lineup);
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
    // check hand not started yet
    if (handId <= hand.handId)
      return Promise.reject('Bad Request: hand ' + handId + ' already started.');
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
    // make leave receipt
      // <12 bytes hand ID>
      // <20 bytes destination>
      // <20 bytes signer addr>
      // <32 r><32 s><1 v>
    const dest = new Buffer(tableAddr.replace('0x',''), 'hex');
    const signer = new Buffer(receipt.signer.replace('0x',''), 'hex');
    const payload = Buffer.concat([ethUtil.setLength(handId, 12), dest, signer]);

    // sign leave receipt
    const priv = new Buffer(RAKE_KEY.replace('0x', ''), 'hex');
    const hash = ethUtil.sha3(payload);
    const sig = ethUtil.ecsign(hash, priv);
    leaveReceipt = '0x'+ payload.toString('hex') + sig.r.toString('hex') + sig.s.toString('hex') + sig.v.toString(16);
    // put leave receipt into lineup and set lastHand
    if (!hand.lineup[pos]) {
      hand.lineup[pos] = {};
    }
    hand.lineup[pos].leaveReceipt = leaveReceipt;
    hand.lineup[pos].lastHand = receipt.values[0];
    return self.db.updateHand(tableAddr, hand.handId, hand.lineup, hand.state, pos);
  }).then(function() {
    // return leave receipt
    return Promise.resolve({ leaveReceipt: leaveReceipt.toString('hex') });
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
    return self.db.updateNetting(tableAddr, handId, signer, nettingSig);
  });
}

TableManager.prototype.timeout = function(tableAddr) {
  const self = this;
  var hand, pos = -1;
  // get the latest hand to check on
  return this.db.getLastHand(tableAddr).then(function(_hand) {
    hand = _hand;
    if (self.helper.checkForNextHand(hand)) {
      // TODO: check in contract if lineup changed.
      pos = (hand.dealer + 2) % hand.lineup.length;
    } else {
      pos = self.helper.whosTurn(hand);
    }
    if (pos == -1) {
      return Promise.reject('Error: could not find next player to act in hand ' + hand.handId);
    }
    var lastActionTime = 0;
    for (var i = 0; i < hand.lineup.length; i++) {
      if (hand.lineup[i].time && hand.lineup[i].time > lastActionTime) {
        lastActionTime = hand.lineup[i].time;
      }
    }
    const leftTime = (lastActionTime + 60) - Math.floor(Date.now() / 1000);
    if (leftTime > 0) {
      return Promise.reject('Bad Request: player ' + pos + ' still got ' + leftTime + ' second to act.');
    }
    hand.lineup[pos].sitout = true;
    return self.updateState(tableAddr, hand, pos);
  });
}

module.exports = TableManager;