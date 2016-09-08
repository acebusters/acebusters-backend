const ethUtil = require('ethereumjs-util');
const EWT = require('ethereum-web-token');

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

var maxBet = function(lineup) {
  var rv = 0;
  for (var i = 0; i < lineup.length; i++) {
    if (!lineup[i].last)
      continue;
    var amount = EWT.parse(lineup[i].last).values[1];
    rv = (amount > rv) ? rv : amount;
  }
  return rv;
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
  for (var i = 0; i < lineup.length; i++) {
    var pos = (i + dealer) % lineup.length;
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
    var rv = {
      lineup: hand.lineup,
      state: hand.handState,
      cards: []
    }
    if (hand.handState == 'flop') {
      rv.cards.push(hand.deck[20]);
      rv.cards.push(hand.deck[21]);
      rv.cards.push(hand.deck[22]);
    }
    if (hand.handState == 'river') {
      rv.cards.push(hand.deck[20]);
      rv.cards.push(hand.deck[21]);
      rv.cards.push(hand.deck[22]);
      rv.cards.push(hand.deck[23]);
    }
    if (hand.handState == 'turn') {
      rv.cards.push(hand.deck[20]);
      rv.cards.push(hand.deck[21]);
      rv.cards.push(hand.deck[22]);
      rv.cards.push(hand.deck[23]);
      rv.cards.push(hand.deck[24]);
    }
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
      //check next hand not started
    return self.db.getHand(tableAddr, handId + 1).then(function(nextHand) {
      return Promise.reject('Bad Request: next hand ' + (nextHand.id + 1) + ' already started.');
    }, function(err) {
      //check signer in lineup
      pos = inLineup(receipt.signer, hand.lineup);
      if (pos < 0)
        return Promise.reject('Forbidden: address ' + receipt.signer + ' not in lineup.');
      //check ewt not reused
      if (hand.lineup[pos].last == ewt)
        return Promise.reject('Unauthorized: you can not reuse receipts.');

      //check bet not too small
      var max = maxBet(hand.lineup);
      if (hand.handState != 'dealing' && receipt.values[1] < max)
        return Promise.reject('Unauthorized: you have to match or raise ' + max);

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
          hand.handState = 'turn';
        if (hand.handState == 'flop')
          hand.handState = 'river';
        if (hand.handState == 'preflop')
          hand.handState = 'flop';
        if (hand.handState == 'dealing')
          hand.handState = 'preflop';
      }
      return self.db.updateHand(tableAddr, handId, hand.lineup, hand.handState);
    })
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
      var dealer = nextDealer(prevHand.lineup, prevHand.dealer);
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

TableManager.prototype.show = function(tableAddr, receipt, cards) {
  //check that it is the right hand to play
  //check that betting 4 completed
  //check that cards match
  //publish distribution
}


module.exports = TableManager;