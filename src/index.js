import ethUtil from 'ethereumjs-util';
import 'buffer-v6-polyfill';
import { PokerHelper, Receipt, Type } from 'poker-helper';
import { Unauthorized, BadRequest, Forbidden, NotFound, Conflict } from './errors';

import { EMPTY_ADDR, getIns, getOuts } from './utils';

const TableManager = function TableManager(
  db,
  contract,
  receiptCache,
  timeout,
  pusher,
  providerUrl,
  sentry,
) {
  this.db = db;
  this.rc = receiptCache;
  this.helper = new PokerHelper(this.rc);
  this.contract = contract;
  this.pusher = pusher;
  this.providerUrl = providerUrl;

  if (typeof timeout !== 'function') {
    this.getTimeout = () => timeout || 60;
  } else {
    this.getTimeout = timeout;
  }

  this.sentry = sentry;
};

TableManager.prototype.log = function log(message, context) {
  const cntxt = (context) || {};
  cntxt.level = (cntxt.level) ? cntxt.level : 'info';
  cntxt.server_name = 'oracle-cashgame';
  return new Promise((resolve, reject) => {
    const now = Math.floor(Date.now() / 1000);
    this.sentry.captureMessage(`${now} - ${message}`, cntxt, (error, eventId) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(eventId);
    });
  });
};

TableManager.prototype.publishUpdate = function publishUpdate(topic, msg) {
  return new Promise((resolve, reject) => {
    try {
      const rsp = this.pusher.trigger(topic, 'update', {
        type: 'chatMessage',
        payload: msg,
      });
      resolve(rsp);
    } catch (err) {
      reject(err);
    }
  });
};

TableManager.prototype.getConfig = function getConfig() {
  return Promise.resolve({
    providerUrl: this.providerUrl,
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
    if (err && err.errName === 'NotFound' &&
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

TableManager.prototype.handleMessage = function handleMessage(msgReceipt) {
  let msg;
  try {
    msg = Receipt.parse(msgReceipt);
  } catch (err) {
    throw new Unauthorized(`invalid message receipt ${msgReceipt}`);
  }
  if (msg.type !== Type.MESSAGE) {
    throw new BadRequest(`receipt type ${msg.type} not allowed.`);
  }
  return this.db.getLastHand(msg.tableAddr).then((hand) => {
    const pos = this.helper.inLineup(msg.signer, hand.lineup);
    if (pos < 0) {
      throw new Forbidden(`address ${msg.signer} not in lineup.`);
    }
    return this.publishUpdate(msg.tableAddr, msgReceipt);
  });
};

TableManager.prototype.pay = function pay(tableAddr, receiptHash) {
  const receipt = this.rc.get(receiptHash);
  const now = Math.floor(Date.now() / 1000);
  const { handId } = receipt;
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
    // check receiptHash not reused
    if (hand.lineup[pos].last === receiptHash) {
      throw new Unauthorized('you can not reuse receipts.');
    }

    // are we ready to start dealing?
    const activeCount = this.helper.countActivePlayers(hand.lineup, hand.state);
    if (hand.state === 'waiting' && activeCount < 2) {
      if ((activeCount === 0 || !hand.lineup[pos].sitout) && receipt.type !== Type.SIT_OUT) {
        throw new BadRequest('not enough players to start game.');
      }
    }

    // make sure to replace receipts in right order
    if (hand.lineup[pos].last) {
      prevReceipt = this.rc.get(hand.lineup[pos].last);
      if (prevReceipt.type === Type.FOLD) {
        throw new BadRequest('no bet after fold.');
      }

      if (prevReceipt.type === Type.SIT_OUT) {
        if (receipt.type === Type.SIT_OUT) {
          throw new BadRequest('can not toggle sitout in same hand.');
        }
        if (receipt.amount > 0 && prevReceipt.amount > 0) {
          throw new BadRequest('wait for next hand.');
        }
      }

      // ToDo: move it outside of the method
      const checks = [
        Type.CHECK_FLOP,
        Type.CHECK_PRE,
        Type.CHECK_RIVER,
        Type.CHECK_TURN,
      ];

      if (checks.indexOf(receipt.type) > -1 && !receipt.amount.eq(prevReceipt.amount)) {
        throw new BadRequest('check should not raise.');
      }
    }

    if (receipt.type === Type.CHECK_PRE && hand.state !== 'preflop') {
      throw new BadRequest('check only during preflop.');
    }

    if (receipt.type === Type.CHECK_FLOP && hand.state !== 'flop') {
      throw new BadRequest('checkFlop only during flop.');
    }

    if (receipt.type === Type.CHECK_TURN && hand.state !== 'turn') {
      throw new BadRequest('checkTurn only during turn.');
    }

    if (receipt.type === Type.CHECK_RIVER && hand.state !== 'river') {
      throw new BadRequest('checkRiver only during river.');
    }
    try {
      turn = this.helper.isTurn(hand.lineup, hand.dealer, hand.state, hand.sb * 2, receipt.signer);
    } catch (err) {
      // we can not determine turn
    }
    if (receipt.type === Type.SIT_OUT) {
      if (hand.lineup[pos].sitout) {
        if (hand.state === 'waiting' || receipt.amount.gt(0)) {
          delete hand.lineup[pos].sitout;
        } else {
          throw new BadRequest('have to pay to return after waiting.');
        }
      } else {
        hand.lineup[pos].sitout = now;
      }
    }
    if (receipt.type === Type.BET) {
      if (hand.state === 'waiting') {
        if (!turn && activeCount > 1) {
          throw new BadRequest('not your turn to pay small blind.');
        }
        // check if receipt is small blind?
        if (!receipt.amount.eq(hand.sb)) {
          throw new BadRequest('small blind not valid.');
        }
      }
    }
    const recAmount = receipt.amount;
    if (hand.state === 'dealing') {
      // check if receipt is big blind?
      if (turn && receipt.type === Type.BET) {
        const bigBlindPos = this.helper.getBbPos(hand.lineup, hand.dealer, hand.state);
        const nextToAct = this.helper.getWhosTurn(hand.lineup,
          hand.dealer, hand.state, hand.sb * 2);
        if (nextToAct === bigBlindPos) {
          if (!recAmount.eq(hand.sb * 2)) {
            throw new BadRequest('big blind not valid.');
          }
        }
      }
    }
    if ((prevReceipt && prevReceipt.amount.lt(recAmount)) || (!prevReceipt && recAmount.gt(0))) {
      // calc bal
      return this.calcBalance(tableAddr, pos, receipt).then((balLeft) => {
        hand.lineup[pos].last = receiptHash;
        if (balLeft === 0) {
          hand.lineup[pos].sitout = 'allin';
        } else if (hand.state !== 'waiting' && hand.state !== 'dealing' &&
            receipt.type === Type.BET) {
          // check bet not too small
          const max = this.helper.getMaxBet(hand.lineup, hand.state);
          if (receipt.amount < max.amount) {
            throw new Unauthorized(`you have to match or raise ${max.amount}`);
          }
        }
        return this.updateState(tableAddr, hand, pos);
      });
    }
    hand.lineup[pos].last = receiptHash;
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
  let bettingComplete = false;
  try {
    bettingComplete = this.helper.isBettingDone(hand.lineup,
    hand.dealer, hand.state, hand.sb * 2);
  } catch (err) {
    console.log(err); // eslint-disable-line no-console
  }
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
    streetMaxBet = this.helper.getMaxBet(hand.lineup, hand.state).amount.toString();
  }

  // take care of all-in
  const activePlayerCount = this.helper.countActivePlayers(hand.lineup, hand.state);
  const allInPlayerCount = this.helper.countAllIn(hand.lineup);
  if (bettingComplete && activePlayerCount <= 1 && allInPlayerCount > 0) {
    hand.state = 'showdown';
  }
  // update db
  return this.db.updateSeat(tableAddr,
    hand.handId, hand.lineup[pos], pos, hand.state, changed, streetMaxBet);
};

TableManager.prototype.calcBalance = function calcBalance(tableAddr, pos, receipt) {
  let amount;
  if (receipt.amount.gt(0)) {
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
      for (let i = rsp.lastHandNetted.toNumber() + 1; i < receipt.handId; i += 1) {
        hands.push(this.db.getHand(tableAddr, i));
      }
      return Promise.all(hands);
    }).then((hands) => {
      for (let i = 0; i < hands.length; i += 1) {
        if (hands[i].lineup[pos].last) {
          amount -= this.rc.get(hands[i].lineup[pos].last).amount.toNumber();
        }
        const outs = this.rc.get(hands[i].distribution).outs;
        if (outs[pos] && hands[i].lineup[pos].address === receipt.signer) {
          amount += outs[pos].toNumber();
        }
      }
      const balLeft = amount - receipt.amount.toNumber();
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
  if (receipt.type !== Type.SHOW) {
    throw new BadRequest('only "show" receipts permitted in showdown.');
  }
  const { handId } = receipt;
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
    if (receipt.amount.lt(prevReceipt.amount)) {
      throw new Unauthorized('you have to submit show with same or highter amount as last receipt.');
    }

    // check cards
    if (cards[0] !== deck[pos * 2] || cards[1] !== deck[(pos * 2) + 1]) {
      throw new BadRequest('you submitted wrong cards.');
    }

    // set the new data
    hand.lineup[pos].last = ewt;
    if (receipt.type === Type.SHOW) {
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
  const receipt = this.rc.get(ewt);
  const { handId } = receipt;
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
    if (pos < 0 || !hand.lineup[pos]) {
      throw new Forbidden(`address ${receipt.signer} not in lineup.`);
    }
    // check signer not submitting another leave receipt
    if (hand.lineup[pos].exitHand) {
      throw new Forbidden(`exitHand ${hand.lineup[pos].exitHand} already set.`);
    }
    // set exitHand
    hand.lineup[pos].exitHand = receipt.handId;
    if (receipt.handId < hand.handId) {
      hand.lineup[pos].sitout = 1;
    }
    return this.db.updateLeave(tableAddr, hand.handId, hand.lineup[pos], pos);
  });
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
    const r = new Buffer(netSigHex.substring(2, 66), 'hex');
    const s = new Buffer(netSigHex.substring(62, 130), 'hex');
    const v = parseInt(netSigHex.substring(0, 2), 16);
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
      if (hand.state === 'waiting') {
        // lineup, startPos, type, state) {
        pos = this.helper.nextPlayer(hand.lineup, 0, 'involved', hand.state);
      }
      if (typeof pos === 'undefined' || hand.lineup[pos].address === EMPTY_ADDR ||
        typeof hand.lineup[pos].sitout === 'number') {
        return Promise.resolve(`could not find next player to act in hand ${hand.handId}`);
      }
    }


    const now = Math.floor(Date.now() / 1000);
    const leftTime = (hand.changed + this.getTimeout(hand.state)) - now;
    if (leftTime > 0) {
      return Promise.resolve(`player ${pos} still got ${leftTime} seconds to act.`);
    }
    hand.lineup[pos].sitout = now;
    return this.updateState(tableAddr, hand, pos);
  });
};

TableManager.prototype.lineup = function lineup(tableAddr) {
  let hand;
  const lup = this.contract.getLineup(tableAddr);
  const ddp = this.db.getLastHand(tableAddr);
  const leavePos = [];
  const joinPos = [];
  return Promise.all([lup, ddp]).then((responses) => {
    hand = responses[1];
    const params = responses[0];
    if (params.lastHandNetted > hand.handId) {
      return Promise.reject(`contract handId ${params.lastHandNetted} ahead of table handId ${hand.handId}`);
    }
    if (!hand.lineup || hand.lineup.length !== params.lineup.length) {
      return Promise.reject(`table lineup length ${hand.lineup.length} does not match contract.`);
    }
    for (let i = 0; i < hand.lineup.length; i += 1) {
      // if seat is taken in table
      if (hand.lineup[i].address &&
        hand.lineup[i].address !== EMPTY_ADDR) {
        // but empty in contract
        if (!params.lineup[i].address ||
          params.lineup[i].address === EMPTY_ADDR) {
          // remember that seat to work on it
          leavePos.push(i);
        }
      }
      // if seat empty in table
      if (!hand.lineup[i].address ||
        hand.lineup[i].address === EMPTY_ADDR) {
        // but filled in contract
        if (params.lineup[i].address &&
          params.lineup[i].address !== EMPTY_ADDR) {
          // remember that seat to work on it
          joinPos.push({ pos: i, addr: params.lineup[i].address });
        }
      }
    }
    if (leavePos.length === 0 && joinPos.length === 0) {
      return Promise.resolve('no changes for lineup detected.');
    }
    const jobProms = [];
    for (let i = 0; i < leavePos.length; i += 1) {
      // we only update the seat, as not to affect the game
      jobProms.push(this.db.setSeat(tableAddr, hand.handId, leavePos[i]));
    }
    // now
    const now = Math.floor(Date.now() / 1000);
    const sitout = (hand.state !== 'waiting' && hand.state !== 'dealing') ? now : null;
    for (let i = 0; i < joinPos.length; i += 1) {
      // we only update the seat, as not to affect the game
      jobProms.push(this.db.setSeat(tableAddr,
        hand.handId, joinPos[i].pos, joinPos[i].addr, sitout));
    }
    if (hand.state === 'waiting' && !this.helper.isActivePlayer(hand.lineup, hand.dealer, hand.state)) {
      // TODO: optimize this, when handstate waiting, we can update everything at once
      let nextDealer = 0;
      try {
        nextDealer = this.helper.nextPlayer(hand.lineup, hand.dealer, 'active');
      } catch (err) {
        // do nothing
      }
      if (joinPos.length > 0) {
        nextDealer = joinPos[0].pos;
      }
      jobProms.push(this.db.setDealer(tableAddr, hand.handId, now, nextDealer));
    }
    return Promise.all(jobProms);
  }).then(() => {
    this.log(`removed players ${JSON.stringify(leavePos)}, added players ${JSON.stringify(joinPos)} in db`, {
      tags: { tableAddr, handId: hand.handId },
    });
  });
};

TableManager.prototype.debugInfo = function debugInfo(tableAddr) {
  const contractData = Promise.all([
    this.contract.getLineup(tableAddr),
    this.contract.lastNettingRequestHandId(tableAddr),
    this.contract.lastNettingRequestTime(tableAddr),
  ]).then(([
    { lineup, lastHandNetted },
    lastNettingRequestHandId,
    lastNettingRequestTime,
  ]) => {
    const promises = [
      getIns(this.contract, tableAddr, lastHandNetted, lineup),
      getOuts(this.contract, tableAddr, lastHandNetted, lineup),
      getIns(this.contract, tableAddr, lastNettingRequestHandId, lineup),
      getOuts(this.contract, tableAddr, lastNettingRequestHandId, lineup),
    ];

    return Promise.all(promises)
      .then(([i1, o1, i2, o2]) => ({
        lineup,
        hands: {
          [lastHandNetted]: { ins: i1, outs: o1 },
          [lastNettingRequestHandId]: { ins: i2, outs: o2 },
        },
        lastHandNetted,
        lastNettingRequestHandId,
        lastNettingRequestTime,
      }));
  });

  const dbData = this.db.getTableHands(tableAddr);

  return Promise.all([contractData, dbData]).then(result => ({
    contract: result[0],
    db: result[1].map(hand => ({
      handId: hand.handId,
      netting: hand.netting,
      distribution: hand.distribution,
      lineup: hand.lineup,
    })),
  }));
};

module.exports = TableManager;
