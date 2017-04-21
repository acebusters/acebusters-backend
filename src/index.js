import EWT from 'ethereum-web-token';
import ethUtil from 'ethereumjs-util';
import { PokerHelper, Receipt } from 'poker-helper';
import { Unauthorized, BadRequest, Forbidden, NotFound, Conflict } from './errors';

const TableManager = function TableManager(db, contract, receiptCache, oraclePriv) {
  this.db = db;
  this.rc = receiptCache;
  this.helper = new PokerHelper(this.rc);
  this.contract = contract;
  if (oraclePriv) {
    this.oraclePriv = oraclePriv;
    const priv = new Buffer(oraclePriv.replace('0x', ''), 'hex');
    this.oracleAddr = `0x${ethUtil.privateToAddress(priv).toString('hex')}`;
  }
};

TableManager.prototype.getConfig = function getConfig(stageVars) {
  return Promise.resolve({
    tableContracts: stageVars.tableContracts.split(','),
    providerUrl: stageVars.providerUrl,
  });
};

TableManager.prototype.info = function info(tableAddr, tableContracts) {
  return this.db.getLastHand(tableAddr).then(hand => Promise.resolve(
    this.helper.renderHand(hand.handId, hand.lineup, hand.dealer, hand.sb,
      hand.state, hand.changed, hand.deck, hand.preMaxBet, hand.flopMaxBet,
      hand.turnMaxBet, hand.riverMaxBet, hand.distribution, hand.netting,
    )), (err) => {
    let tables = [];
    if (tableContracts) {
      tables = tableContracts.split(',');
    }
    if (err.name && err.name === 'NotFound' &&
      tables.indexOf(tableAddr) > -1) {
      return Promise.resolve({
        handId: 0,
        dealer: 0,
        state: 'showdown',
        distribution: '0x1234',
      });
    }
    throw err;
  });
};

TableManager.prototype.getHand = function getHand(tableAddr, handIdStr) {
  const handId = parseInt(handIdStr, 10);
  return this.db.getHand(tableAddr, handId).then(hand => Promise.resolve(
    this.helper.renderHand(hand.handId, hand.lineup, hand.dealer, hand.sb,
      hand.state, hand.changed, hand.deck, hand.preMaxBet, hand.flopMaxBet,
      hand.turnMaxBet, hand.riverMaxBet, hand.distribution, hand.netting,
    ),
  ));
};

TableManager.prototype.pay = function pay(tableAddr, ewt) {
  const receipt = this.rc.get(ewt);
  const now = Math.floor(Date.now() / 1000);
  const handId = receipt.values[0];
  let hand;
  let turn;
  let dist;
  let deck;
  let prevReceipt;
  let pos;
  return this.db.getLastHand(tableAddr).then((_hand) => {
    hand = _hand;
    deck = _hand.deck;
    if (hand.handId !== handId) {
      throw new BadRequest(`unknown handId ${handId}, currently playing ${hand.handId}`);
    }
    // check hand not finished yet
    if (hand.distribution !== undefined) {
      throw new BadRequest(`hand ${hand.handId} has distribution already.`);
    }
    // check signer in lineup
    pos = this.helper.inLineup(receipt.signer, hand.lineup);
    if (pos < 0) {
      throw new Forbidden(`address ${receipt.signer} not in lineup.`);
    }
    // check signer not leaving
    if (hand.lineup[pos].exitHand && hand.lineup[pos].exitHand < hand.handId) {
      throw new Forbidden(`exitHand ${hand.lineup[pos].exitHand} exceeded.`);
    }
    // check ewt not reused
    if (hand.lineup[pos].last === ewt) {
      throw new Unauthorized('you can not reuse receipts.');
    }

    // are we ready to start dealing?
    const activeCount = this.helper.countActivePlayers(hand.lineup, hand.state);
    if (hand.state === 'waiting' && activeCount < 2) {
      if (activeCount === 0 || !hand.lineup[pos].sitout) {
        throw new BadRequest('not enough players to start game.');
      }
    }

    // make sure to replace receipts in right order
    if (hand.lineup[pos].last) {
      prevReceipt = this.rc.get(hand.lineup[pos].last);
      if (prevReceipt.abi[0].name === 'fold') {
        throw new BadRequest('no bet after fold.');
      }

      if (prevReceipt.abi[0].name === 'sitOut') {
        if (receipt.abi[0].name === 'bet' || receipt.abi[0].name === 'sitOut') {
          throw new BadRequest('can not toggle sitout in same hand.');
        }
      }

      if (receipt.abi[0].name.indexOf('check') > -1 && receipt.values[1] !== prevReceipt.values[1]) {
        throw new BadRequest('check should not raise.');
      }
    }

    if (receipt.abi[0].name === 'checkPre' && hand.state !== 'preflop') {
      throw new BadRequest('check only during preflop.');
    }

    if (receipt.abi[0].name === 'checkFlop' && hand.state !== 'flop') {
      throw new BadRequest('checkFlop only during flop.');
    }

    if (receipt.abi[0].name === 'checkTurn' && hand.state !== 'turn') {
      throw new BadRequest('checkTurn only during turn.');
    }

    if (receipt.abi[0].name === 'checkRiver' && hand.state !== 'river') {
      throw new BadRequest('checkRiver only during river.');
    }
    try {
      turn = this.helper.isTurn(hand.lineup, hand.dealer, hand.state, hand.sb * 2, receipt.signer);
    } catch (err) {
      // we can not determine turn
    }
    if (receipt.abi[0].name === 'sitOut') {
      if (hand.lineup[pos].sitout) {
        delete hand.lineup[pos].sitout;
      } else {
        hand.lineup[pos].sitout = now;
      }
    }
    if (receipt.abi[0].name === 'bet') {
      if (hand.state === 'waiting') {
        if (!turn && activeCount > 1) {
          throw new BadRequest('not your turn to pay small blind.');
        }
        // check if receipt is small blind?
        if (receipt.values[1] !== hand.sb) {
          throw new BadRequest('small blind not valid.');
        }
      }
    }
    const recAmount = receipt.values[1];
    if (hand.state === 'dealing') {
      // check if receipt is big blind?
      if (turn && receipt.abi[0].name === 'bet') {
        const bigBlindPos = this.helper.getBbPos(hand.lineup, hand.dealer, hand.state);
        const nextToAct = this.helper.getWhosTurn(hand.lineup,
          hand.dealer, hand.state, hand.sb * 2);
        if (nextToAct === bigBlindPos) {
          if (recAmount !== hand.sb * 2) {
            throw new BadRequest('big blind not valid.');
          }
        }
      }
    }
    if ((prevReceipt && prevReceipt.values[1] < recAmount) || (!prevReceipt && recAmount > 0)) {
      // calc bal
      return this.calcBalance(tableAddr, pos, receipt).then((balLeft) => {
        hand.lineup[pos].last = ewt;
        if (balLeft === 0) {
          hand.lineup[pos].sitout = 'allin';
        } else if (hand.state !== 'waiting' && hand.state !== 'dealing' &&
            receipt.abi[0].name === 'bet') {
          // check bet not too small
          const max = this.helper.getMaxBet(hand.lineup, hand.state);
          if (receipt.values[1] < max.amount) {
            throw new Unauthorized(`you have to match or raise ${max.amount}`);
          }
        }
        return this.updateState(tableAddr, hand, pos);
      });
    }
    hand.lineup[pos].last = ewt;
    return this.updateState(tableAddr, hand, pos);
  }).then(() => {
    let rsp = (deck) ? { cards: [deck[pos * 2], deck[(pos * 2) + 1]] } : {};
    rsp = (dist) ? { distribution: dist } : rsp;
    return Promise.resolve(rsp);
  });
};

TableManager.prototype.updateState = function updateState(tableAddr, handParam, pos) {
  const hand = handParam;
  const changed = Math.floor(Date.now() / 1000);
  const max = this.helper.getMaxBet(hand.lineup, hand.state);
  const bettingComplete = this.helper.isBettingDone(hand.lineup,
    hand.dealer, hand.state, hand.sb * 2);
  const handComplete = this.helper.isHandComplete(hand.lineup, hand.dealer, hand.state);
  let streetMaxBet;
  if (bettingComplete && !handComplete) {
    if (hand.state === 'river') {
      hand.state = 'showdown';
    }
    if (hand.state === 'turn') {
      hand.state = 'river';
    }
    if (hand.state === 'flop') {
      hand.state = 'turn';
    }
    if (hand.state === 'preflop') {
      hand.state = 'flop';
    }
    if (hand.state === 'dealing') {
      hand.state = 'preflop';
    }
    if (hand.state === 'waiting') {
      hand.state = 'dealing';
    }
    streetMaxBet = max.amount;
  }

  // take care of all-in
  const activePlayerCount = this.helper.countActivePlayers(hand.lineup, hand.state);
  const allInPlayerCount = this.helper.countAllIn(hand.lineup);
  if (bettingComplete && activePlayerCount === 1 && allInPlayerCount > 0) {
    hand.state = 'showdown';
  }
  // update db
  return this.db.updateSeat(tableAddr,
    hand.handId, hand.lineup[pos], pos, hand.state, changed, streetMaxBet);
};

TableManager.prototype.calcBalance = function calcBalance(tableAddr, pos, receipt) {
  let amount;
  if (receipt.values[1] > 0) {
    // check if balance sufficient
    // 1. get balance at last netted
    // 2. go hand by hand till current hand - 1
      // substract all bets
      // add all winnings
    // 3. check if amount - bet > 0
    return this.contract.getLineup(tableAddr).then((rsp) => {
      amount = rsp.lineup[pos].amount.toNumber();
      // return get all old hands
      const hands = [];
      for (let i = rsp.lastHandNetted.toNumber() + 1; i < receipt.values[0]; i += 1) {
        hands.push(this.db.getHand(tableAddr, i));
      }
      return Promise.all(hands);
    }).then((hands) => {
      for (let i = 0; i < hands.length; i += 1) {
        if (hands[i].lineup[pos].last) {
          amount -= this.rc.get(hands[i].lineup[pos].last).values[1];
        }
        const dists = this.rc.get(hands[i].distribution).values[2];
        for (let j = 0; j < dists.length; j += 1) {
          const dist = EWT.separate(dists[j]);
          if (dist.address === receipt.signer) {
            amount += dist.amount;
          }
        }
      }
      const balLeft = amount - receipt.values[1];
      if (balLeft >= 0) {
        return Promise.resolve(balLeft);
      }
      throw new Forbidden(`can not bet more than balance (${amount}).`);
    }, err => Promise.reject(err));
  }
  return Promise.resolve();
};

TableManager.prototype.show = function show(tableAddr, ewt, cards) {
  if (!cards || Object.prototype.toString.call(cards) !== '[object Array]' || cards.length !== 2) {
    throw new BadRequest('cards should be submitted as array.');
  }
  let hand;
  let deck;
  let dist;
  let pos;
  const receipt = this.rc.get(ewt);
  // check receipt type
  if (receipt.abi[0].name !== 'show' && receipt.abi[0].name !== 'muck') {
    throw new BadRequest('only "show" and "muck" receipts permitted in showdown.');
  }
  const handId = receipt.values[0];
  // check if this hand exists
  return this.db.getHand(tableAddr, handId).then((_hand) => {
    hand = _hand;
    deck = _hand.deck;
    if (hand.state !== 'showdown') {
      throw new BadRequest(`hand ${handId} not in showdown.`);
    }
    pos = this.helper.inLineup(receipt.signer, hand.lineup);
    if (pos < 0) {
      throw new Forbidden(`address ${receipt.signer} not in lineup.`);
    }
    // check user allow to participate in showdown
    if (hand.lineup[pos].sitout && hand.lineup[pos].sitout.indexOf('allin') < 0) {
      throw new Forbidden(`seat ${pos} in sitout, not allowed in showdown.`);
    }
    if (!this.helper.isActivePlayer(hand.lineup, pos, hand.state) && hand.lineup[pos].sitout !== 'allin') {
      throw new Forbidden(`seat ${pos} is not an active player.`);
    }
    // check ewt not reused
    if (hand.lineup[pos].last === ewt) {
      throw new Unauthorized('you can not reuse receipts.');
    }

    const prevReceipt = this.rc.get(hand.lineup[pos].last);
    if (receipt.values[1] < prevReceipt.values[1]) {
      throw new Unauthorized('you have to submit show with same or highter amount as last receipt.');
    }

    // check cards
    if (cards[0] !== deck[pos * 2] || cards[1] !== deck[(pos * 2) + 1]) {
      throw new BadRequest('you submitted wrong cards.');
    }

    // set the new data
    hand.lineup[pos].last = ewt;
    if (receipt.abi[0].name === 'show') {
      hand.lineup[pos].cards = cards;
    }
    if (hand.lineup[pos].sitout === 'allin') {
      delete hand.lineup[pos].sitout;
    }
    // update db
    const changed = Math.floor(Date.now() / 1000);
    return this.db.updateSeat(tableAddr, hand.handId, hand.lineup[pos], pos, hand.state, changed);
  }).then(() => Promise.resolve(dist));
};

TableManager.prototype.leave = function leave(tableAddr, ewt) {
  let hand;
  let pos = -1;
  let leaveReceipt;
  const receipt = this.rc.get(ewt);
  const handId = receipt.values[0];
  // check if this hand exists
  return this.db.getLastHand(tableAddr).then((_hand) => {
    hand = _hand;
    const minHandId = (hand.state === 'waiting') ? hand.handId - 1 : hand.handId;
    if (handId < minHandId) {
      throw new BadRequest(`forbidden to exit at handId ${handId}`);
    }
    // check signer in lineup
    return this.contract.getLineup(tableAddr);
  }).then((rsp) => {
    for (let i = 0; i < rsp.lineup.length; i += 1) {
      if (receipt.signer === rsp.lineup[i].address) {
        pos = i;
        break;
      }
    }
    if (pos < 0) {
      throw new Forbidden(`address ${receipt.signer} not in lineup.`);
    }
    // check signer not submitting another leave receipt
    if (hand.lineup[pos] && hand.lineup[pos].exitHand) {
      throw new Forbidden(`exitHand ${hand.lineup[pos].exitHand} already set.`);
    }
    leaveReceipt = Receipt.leave(tableAddr, handId, receipt.signer).sign(this.oraclePriv);
    // put leave receipt into lineup and set exitHand
    if (!hand.lineup[pos]) {
      hand.lineup[pos] = {};
    }
    hand.lineup[pos].leaveReceipt = leaveReceipt;
    hand.lineup[pos].exitHand = receipt.values[0];
    if (receipt.values[0] < hand.handId) {
      hand.lineup[pos].sitout = 1;
    }
    return this.db.updateLeave(tableAddr, hand.handId, hand.lineup[pos], pos);
  }).then(() => Promise.resolve({ leaveReceipt }));
};

TableManager.prototype.netting = function netting(tableAddr, handIdStr, nettingSig) {
  const handId = parseInt(handIdStr, 10);
  return this.db.getHand(tableAddr, handId).then((hand) => {
    if (nettingSig === undefined || nettingSig.length < 130 || nettingSig.length > 132) {
      throw new BadRequest(`nettingSig ${nettingSig} invalid.`);
    }
    if (hand.netting === undefined) {
      throw new BadRequest(`hand ${handId} has no netting.`);
    }
    // do ecrecover
    const netSigHex = nettingSig.replace('0x', '');
    const r = new Buffer(netSigHex.substring(0, 64), 'hex');
    const s = new Buffer(netSigHex.substring(64, 128), 'hex');
    const v = parseInt(netSigHex.substring(128, 130), 16);
    const payload = new Buffer(hand.netting.newBalances.replace('0x', ''), 'hex');
    const hash = ethUtil.sha3(payload);
    const pub = ethUtil.ecrecover(hash, v, r, s);
    const signer = `0x${ethUtil.pubToAddress(pub).toString('hex')}`;
    if (hand.netting[signer] !== undefined) {
      throw new Conflict(`signer ${signer} already delivered nettingSig.`);
    }
    let isSignerInLineup = false;
    for (let i = 0; i < hand.lineup.length; i += 1) {
      if (hand.lineup[i].address === signer) {
        isSignerInLineup = true;
        break;
      }
    }
    if (!isSignerInLineup) {
      throw new NotFound(`signer ${signer} not in lineup.`);
    }
    return this.db.updateNetting(tableAddr, handId, signer, nettingSig);
  });
};

TableManager.prototype.timeout = function timeout(tableAddr) {
  let hand;
  // get the latest hand to check on
  return this.db.getLastHand(tableAddr).then((_hand) => {
    hand = _hand;
    let pos;
    try {
      pos = this.helper.getWhosTurn(hand.lineup, hand.dealer, hand.state, hand.sb * 2);
    } catch (e) {
      throw new BadRequest(`could not find next player to act in hand ${hand.handId}`);
    }

    const now = Math.floor(Date.now() / 1000);
    const leftTime = (hand.changed + 180) - now;
    if (leftTime > 0) {
      throw new BadRequest(`player ${pos} still got ${leftTime} second to act.`);
    }
    hand.lineup[pos].sitout = now;
    return this.updateState(tableAddr, hand, pos);
  });
};

module.exports = TableManager;
