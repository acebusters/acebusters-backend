const ethUtil = require('ethereumjs-util');
const EWT = require('ethereum-web-token');
var Solver = require('pokersolver');

const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['c', 'd', 'h', 's'];
const RAKE = 0.01;
//secretSeed: 'erode melody nature bounce sample deny spend give craft alcohol supply roof' }
const RAKE_ADDR = '0x82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f';
const RAKE_KEY = '0x94890218f2b0d04296f30aeafd13655eba4c5bbf1770273276fee52cbe3f2cb4';

const ABI_DIST = [{name: 'distribution', type: 'function', inputs: [{type: 'uint256'},{type: 'uint256'},{type: 'address[]'},{type: 'uint256[]'}]}];

var shuffle = function() {
  var array = [];
  for (var i = 0; i < 52; i++)
    array.push(i);
  for (i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * i);
    var temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
  return array;
}

var getSmallBlind = function(lineup, dealer) {
  for (var i = 0; i < lineup.length; i++) {
    var pos = (i + dealer) % lineup.length;
    if (lineup[pos].last)
      return lineup[pos].last;
  }
}

var inLineup = function(signer, lineup) {
  for (var i = 0; i < lineup.length; i++)
    if (lineup[i].address == signer)
      return i;
  return -1;
}

var findMaxBet = function(lineup) {
  var max = 0;
  for (var i = 0; i < lineup.length; i++) {
    if (!lineup[i].last)
      continue;
    var amount = EWT.parse(lineup[i].last).values[1];
    max = (amount > max) ? amount : max;
  }
  return max;
}

var activeSeats = function(lineup) {
  var rv = 0;
  for (var i = 0; i < lineup.length; i++) {
    if (lineup[i].address && !lineup[i].sitout)
      rv++;
  }
  return rv;
}

var isBlind = function(blind, amount) {
  //TODO receipt type
  return (blind.values[1] == amount);
}

var nextDealer = function(lineup, dealer) {
  dealer = (dealer) ? dealer : -1;
  for (var i = 0; i < lineup.length; i++) {
    var pos = (i + dealer + 1) % lineup.length;
    if (!lineup[pos].sitout)
      return pos;
  }
  return 0;
}

var allDone = function(lineup, dealer, handState, max) {
  var pos, done = true;
  var i = (handState == 'dealing') ? 2 : 0;
  for (; i < lineup.length; i++) {
    pos = (i + dealer) % lineup.length;
    if (!lineup[pos].last)
      return false;
    var last = EWT.parse(lineup[pos].last);
    if (last.abi[0].name != 'fold' && last.abi[0].name != 'sitout' && last.values[1] != max)
      return false
  }
  return done;
}

var isTurn = function(lineup, dealer, signer) {
  var i = (lineup[dealer].last) ? 1 : 0;
  for (; i < lineup.length; i++) {
    var pos = (i + dealer) % lineup.length;
    if (!lineup[pos].sitout)
      return (lineup[pos].address == signer);
  }
  return false;
}

var TableManager = function(db, contract) {
  this.db = db;
  this.contract = contract;
}

TableManager.prototype.info = function(tableAddr) {
  return this.db.getLastHand(tableAddr).then(function(hand) {
    if (hand.handState == 'showdown') {
      for (var i = 0; i < hand.lineup.length; i++) {
        var last = EWT.parse(hand.lineup[i].last);
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
      state: hand.handState,
      cards: []
    }
    if (hand.handState == 'flop') {
      rv.cards.push(hand.deck[20]);
      rv.cards.push(hand.deck[21]);
      rv.cards.push(hand.deck[22]);
    }
    if (hand.handState == 'turn') {
      rv.cards.push(hand.deck[20]);
      rv.cards.push(hand.deck[21]);
      rv.cards.push(hand.deck[22]);
      rv.cards.push(hand.deck[23]);
    }
    if (hand.handState == 'river' || hand.handState == 'showdown') {
      rv.cards.push(hand.deck[20]);
      rv.cards.push(hand.deck[21]);
      rv.cards.push(hand.deck[22]);
      rv.cards.push(hand.deck[23]);
      rv.cards.push(hand.deck[24]);
    }
    if (hand.handState == 'showdown')
      rv.distribution = hand.distribution;
    return Promise.resolve(rv);
  });
}

TableManager.prototype.pay = function(tableAddr, ewt) {
  var self = this, hand, prevHand, deck, pos = -1,
    receipt = EWT.parse(ewt);
  var handId = receipt.values[0];
  //check if this hand exists
  return this.db.getHand(tableAddr, handId).then(function(_hand) {
    hand = _hand;
    deck = _hand.deck;
    //if yes
    //check hand not finished yet
    if (hand.handState == 'showdown')
      return Promise.reject('Bad Request: hand ' + handId + ' in showdown or completed.');
    //check signer in lineup
    pos = inLineup(receipt.signer, hand.lineup);
    if (pos < 0)
      return Promise.reject('Forbidden: address ' + receipt.signer + ' not in lineup.');
    //check ewt not reused
    if (hand.lineup[pos].last == ewt)
      return Promise.reject('Unauthorized: you can not reuse receipts.');

    //check bet not too small
    var max = findMaxBet(hand.lineup);
    if (hand.handState != 'dealing' && receipt.values[1] < max)
      return Promise.reject('Unauthorized: you have to match or raise ' + max);

    //make sure to replace receipts in right order
    if (hand.lineup[pos].last) {
      var prevReceipt = EWT.parse(hand.lineup[pos].last);
      console.log('prev rec: ' + prevReceipt.abi[0].name);
      console.log('new rec: ' + receipt.abi[0].name);
      if (prevReceipt.abi[0].name == 'fold')
        return Promise.reject('Bad Request: no bet after fold.');

      if (prevReceipt.abi[0].name == 'sitOut' && hand.handState != 'dealing')
        return Promise.reject('Bad Request: leave sitout only during dealing.');

      if (receipt.abi[0].name.indexOf('check') > -1 && receipt.values[1] != prevReceipt.values[1]) {
        return Promise.reject('Bad Request: check should not raise.');
      }
    }

    if (receipt.abi[0].name == 'check' && hand.handState != 'preflop')
      return Promise.reject('Bad Request: check only during preflop.');

    if (receipt.abi[0].name == 'checkFlop' && hand.handState != 'flop')
      return Promise.reject('Bad Request: checkFlop only during flop.');

    if (receipt.abi[0].name == 'checkTurn' && hand.handState != 'turn')
      return Promise.reject('Bad Request: checkTurn only during turn.');

    if (receipt.abi[0].name == 'checkRiver' && hand.handState != 'river')
      return Promise.reject('Bad Request: checkRiver only during river.');

    max = (receipt.values[1] > max) ? receipt.values[1] : max;
    if (hand.handState == 'dealing') {
      //check if receipt is big blind?
      var turn = isTurn(hand.lineup, hand.dealer, receipt.signer);
      if (turn) {
        var smallBlind = getSmallBlind(hand.lineup, hand.dealer);
        var sb = EWT.parse(smallBlind);
        if (!isBlind(receipt, sb.values[1] * 2))
          return Promise.reject('Bad Request: big blind not valid.');
      } else {
        //collect 0 receipts
        if (!isBlind(receipt, 0))
          return Promise.reject('Bad Request: only 0 receipts allowed');
      }
    }
    //update db
    hand.lineup[pos].last = ewt;
    if (allDone(hand.lineup, hand.dealer, hand.handState, max)) {
      if (hand.handState == 'river')
        hand.handState = 'showdown';
      if (hand.handState == 'turn')
        hand.handState = 'river';
      if (hand.handState == 'flop')
        hand.handState = 'turn';
      if (hand.handState == 'preflop')
        hand.handState = 'flop';
      if (hand.handState == 'dealing')
        hand.handState = 'preflop';
    }
    return self.db.updateHand(tableAddr, handId, hand.lineup, hand.handState);
  }, function(err) {
  //if no
    //check if last hand completed
    return self.db.getHand(tableAddr, handId - 1).then(function(_prevHand) {
      prevHand = _prevHand;
      //if no, exit
      if (!prevHand.distribution)
        return Promise.reject('Bad Request: previous hand ' + prevHand.handId + ' still playing.');
      //get lineup from contract (what are small and big blinds?)
      var lineup = self.contract.getLineup(tableAddr);
      var params = self.contract.getParams(tableAddr);
      return Promise.all([lineup, params]);
    }).then(function(vals) {
      var lineup = vals[0], 
          params = vals[1];
      for (var i = 0; i < lineup.length; i++) {
        if (receipt.signer == lineup[i])
          pos = i;
        lineup[i] = {address: lineup[i]};
      }
      if (pos < 0)
        return Promise.reject('Forbidden: address ' + receipt.signer + ' not in lineup.');
      //check enough players
      if (activeSeats(lineup)<2)
        return Promise.reject('Bad Request: no-one there to play.');
      //check if receipt is small blind?
      if (!isBlind(receipt, params.bigBlind / 2))
        return Promise.reject('Bad Request: small blind not valid.');
      //check that it is players turn to pay small blind
      var dealer = nextDealer(lineup, prevHand.dealer);
      if (!isTurn(lineup, dealer, receipt.signer))
        return Promise.reject('Bad Request: not your turn to pay small blind.');
      //create hand, deck and safe small blind
      deck = shuffle();
      lineup[pos].last = ewt;
      return self.db.putHand(tableAddr, receipt.values[0], lineup, dealer, deck);
    })
  }).then(function(){
    return Promise.resolve({cards: [deck[pos * 2], deck[pos * 2 + 1]]});
  });
}

TableManager.prototype.show = function(tableAddr, ewt, cards) {
  if (!cards || Object.prototype.toString.call(cards) !== '[object Array]' || cards.length !== 2)
    return Promise.reject('Bad Request: cards should be submitted as array.');
  var self = this, hand, deck, dist, pos = -1, receipt = EWT.parse(ewt);
  var handId = receipt.values[0];
  //check if this hand exists
  return this.db.getHand(tableAddr, handId).then(function(_hand) {
    hand = _hand;
    deck = _hand.deck;
    if (hand.handState != 'showdown')
      return Promise.reject('Bad Request: hand ' + handId + ' not in showdown.');
    pos = inLineup(receipt.signer, hand.lineup);
    if (pos < 0)
      return Promise.reject('Forbidden: address ' + receipt.signer + ' not in lineup.');
    //check ewt not reused
    if (hand.lineup[pos].last == ewt)
      return Promise.reject('Unauthorized: you can not reuse receipts.');
    if (cards[0] != deck[pos * 2] || cards[1] != deck[pos * 2 + 1])
      return Promise.reject('Bad Request: you submitted wrong cards.');
    if (receipt.abi[0].name != 'show' && receipt.abi[0].name != 'muck')
      return Promise.reject('Bad Request: only "show" and "muck" receipts permitted in showdown.');
    //create hands
    var i, j, hands = [], pots = [];
    for (i = 0; i < hand.lineup.length; i++) {
      var h = [];
      h.push(deck[i * 2]);
      h.push(deck[i * 2 + 1]);
      h.push(hand.deck[20]);
      h.push(hand.deck[21]);
      h.push(hand.deck[22]);
      h.push(hand.deck[23]);
      h.push(hand.deck[24]);
      hands.push(h);
      if (pots.length == 0)
        pots.push(0);
      var last = EWT.parse(hand.lineup[i].last);
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
    var distAmounts = [];
    var distAddrs = [];
    distAmounts.push(pots[0] * RAKE); //rake
    distAddrs.push(RAKE_ADDR);
    for (i = 0; i < hand.lineup.length; i++) {
      for (j = 0; j < winners.length; j++) {
        if (hands[i] == winners[j]) {
          distAmounts.push((pots[0] - (pots[0] * RAKE)) / (winners.length));
          distAddrs.push(hand.lineup[i].address);
        }
      }
    }
    var claimId = 0;
    if (hand.distribution) {
      claimId = EWT.parse(hand.distribution).values[1] + 1;
    }
    dist = new EWT(ABI_DIST).distribution(handId, claimId, distAddrs, distAmounts).sign(RAKE_KEY);
    return self.db.updateHandDist(tableAddr, handId, dist);
  }).then(function() {
    return Promise.resolve(dist);
  });
}


module.exports = TableManager;