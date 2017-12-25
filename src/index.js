import 'buffer-v6-polyfill';
import request from 'request';
import ethUtil from 'ethereumjs-util';
import { PokerHelper, Receipt, Type } from 'poker-helper';
import { Unauthorized, BadRequest, Forbidden, NotFound, Conflict } from './errors';
import {
  EMPTY_ADDR,
  seatIsEmpty,
  getNextDealer,
  now,
  getPrevReceipt,
  validateCheck,
  getIsTurn,
  calcLeaveExitHand,
  checks,
} from './utils';
import { emulateSeatsUpdate } from './db';

class TableManager {
  constructor(
    db,
    contract,
    receiptCache,
    timeout,
    pusher,
    providerUrl,
    logger,
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

    this.logger = logger;
  }

  publishUpdate(topic, msg) {
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
  }

  async getConfig() {
    return {
      providerUrl: this.providerUrl,
    };
  }

  async info(tableAddr, tableContracts) {
    try {
      const hand = await this.db.getLastHand(tableAddr);
      const info = this.helper.renderHand(hand.handId, hand.lineup, hand.dealer, hand.sb,
        hand.state, hand.changed, hand.deck, hand.preMaxBet, hand.flopMaxBet,
        hand.turnMaxBet, hand.riverMaxBet, hand.distribution, hand.netting,
      );
      return { ...info, started: hand.started };
    } catch (err) {
      const tables = tableContracts ? tableContracts.split(',') : [];
      if (err && err.errName === 'NotFound' && tables.indexOf(tableAddr) > -1) {
        return {
          handId: 0,
          dealer: 0,
          state: 'showdown',
          distribution: '0x1234',
        };
      }
      throw err;
    }
  }

  getHand(tableAddr, handId) {
    return this.db.getHand(tableAddr, Number(handId)).then(hand => this.helper.renderHand(
      hand.handId, hand.lineup, hand.dealer, hand.sb,
      hand.state, hand.changed, hand.deck, hand.preMaxBet, hand.flopMaxBet,
      hand.turnMaxBet, hand.riverMaxBet, hand.distribution, hand.netting,
    ));
  }

  handleMessage(msgReceipt) {
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
  }

  async beat(tableAddr, receiptHash) {
    const receipt = this.rc.get(receiptHash);

    if (receipt.type !== Type.WAIT) {
      throw new Unauthorized('Wrong receipt type');
    }

    if (receipt.tableAddr !== tableAddr) {
      throw new Unauthorized('Wrong table address');
    }

    if (receipt.created < now(-60 * 5)) {
      throw new Unauthorized('Receipt too old');
    }
    const { lineup } = await this.contract.getLineup(tableAddr);
    const pos = lineup.findIndex(seat => seat.address === receipt.signer);
    if (pos < 0) {
      throw new Forbidden(`address ${receipt.signer} not in lineup.`);
    }

    const hand = await this.db.getLastHand(tableAddr);
    return this.db.updateChanged(tableAddr, hand.handId, now());
  }

  async pay(tableAddr, receiptHash) {
    const receipt = this.rc.get(receiptHash);
    const { handId } = receipt;
    const hand = await this.db.getLastHand(tableAddr);

    if (hand.handId !== handId) {
      throw new BadRequest(`unknown handId ${handId}, currently playing ${hand.handId}`);
    }

    // check hand not finished yet
    if (hand.distribution !== undefined) {
      throw new BadRequest(`hand ${hand.handId} has distribution already.`);
    }

    // check signer in lineup
    const pos = this.helper.inLineup(receipt.signer, hand.lineup);
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
    const prevReceipt = getPrevReceipt(this.helper, this.rc, receipt, hand, pos);
    if (prevReceipt) {
      if (checks.indexOf(receipt.type) > -1 && !receipt.amount.eq(prevReceipt.amount)) {
        throw new BadRequest('check should not raise.');
      }
    }

    if (checks.indexOf(receipt.type) > -1) {
      validateCheck(hand, receipt);
    }

    const turn = getIsTurn(this.helper, hand, receipt);
    if (receipt.type === Type.SIT_OUT) {
      if (hand.lineup[pos].sitout) {
        if (hand.state === 'waiting' || receipt.amount.gt(0)) {
          delete hand.lineup[pos].sitout;
        } else {
          throw new BadRequest('have to pay to return after waiting.');
        }
      } else {
        hand.lineup[pos].sitout = now();
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
        const nextToAct = this.helper.getWhosTurn(
          hand.lineup,
          hand.dealer,
          hand.state,
          hand.sb * 2,
        );
        if (nextToAct === bigBlindPos) {
          if (!recAmount.eq(hand.sb * 2)) {
            throw new BadRequest('big blind not valid.');
          }
        }
      }
    }

    if ((prevReceipt && prevReceipt.amount.lt(recAmount)) || (!prevReceipt && recAmount.gt(0))) {
      // calc bal
      const balLeft = await this.calcBalance(tableAddr, pos, receipt);
      hand.lineup[pos].last = receiptHash;
      if (balLeft === 0) {
        hand.lineup[pos].sitout = 'allin';
      } else if (
        hand.state !== 'waiting' &&
        hand.state !== 'dealing' &&
        receipt.type === Type.BET
      ) {
        // check bet not too small
        const max = this.helper.getMaxBet(hand.lineup, hand.state);
        if (receipt.amount < max.amount) {
          throw new Unauthorized(`you have to match or raise ${max.amount}`);
        }
      }
      await this.updateState(tableAddr, hand, pos);
    } else {
      hand.lineup[pos].last = receiptHash;
      await this.updateState(tableAddr, hand, pos);
    }

    const response = {};
    if (hand.distribution) {
      response.distribution = hand.distribution;
    }

    if (hand.deck) {
      response.cards = [hand.deck[pos * 2], hand.deck[(pos * 2) + 1]];
    }

    return response;
  }

  updateState(tableAddr, handParam, pos) {
    const hand = handParam;
    const changed = now();
    let bettingComplete = false;
    try {
      bettingComplete = this.helper.isBettingDone(hand.lineup,
      hand.dealer, hand.state, hand.sb * 2);
    } catch (err) {
      this.logger.log('\'is betting done\' error', {
        tags: { tableAddr, handId: hand.handId },
      });
    }
    const handComplete = this.helper.isHandComplete(hand.lineup, hand.dealer, hand.state);
    let streetMaxBet;
    const prevState = hand.state;
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
    if (bettingComplete) {
      if ((activePlayerCount === 1 && allInPlayerCount > 0) ||
          (activePlayerCount === 0 && allInPlayerCount > 1)) {
        hand.state = 'showdown';
      } else if (activePlayerCount === 0 && allInPlayerCount < 2) {
        // when there are no active players and only one all-in player,
        // then we should just finish hand
        hand.state = prevState;
      }
    }
    // update db
    return this.db.updateSeat(tableAddr,
      hand.handId, hand.lineup[pos], pos, hand.state, changed, streetMaxBet);
  }

  async calcBalance(tableAddr, pos, receipt) {
    if (receipt.amount.gt(0)) {
      // check if balance sufficient
      // 1. get balance at last netted
      // 2. go hand by hand till current hand - 1
        // substract all bets
        // add all winnings
      // 3. check if amount - bet > 0
      const { lineup, lastHandNetted } = await this.contract.getLineup(tableAddr);
      // get all old hands
      const hands = await this.db.getHands(
        tableAddr,
        lastHandNetted.toNumber() + 1,
        receipt.handId,
      );

      const subLast = (hand, amount) => (
        hand.lineup && hand.lineup[pos].last
        ? amount - this.rc.get(hand.lineup[pos].last).amount.toNumber()
        : amount
      );
      const addOut = (hand, amount) => {
        const { outs } = this.rc.get(hand.distribution);
        if (outs[pos] && hand.lineup[pos].address === receipt.signer) {
          return amount + outs[pos].toNumber();
        }

        return amount;
      };

      const amount = hands.reduce(
        (mem, hand) => addOut(hand, subLast(hand, mem)),
        lineup[pos].amount.toNumber(),
      );

      const balLeft = amount - receipt.amount.toNumber();
      if (balLeft >= 0) {
        return balLeft;
      }
      throw new Forbidden(`can not bet more than balance (${amount}).`);
    }

    return undefined;
  }

  show(tableAddr, receiptString, cards) {
    if (!cards || Object.prototype.toString.call(cards) !== '[object Array]' || cards.length !== 2) {
      throw new BadRequest('cards should be submitted as array.');
    }
    let hand;
    let deck;
    let dist;
    let pos;
    const receipt = this.rc.get(receiptString);
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
      // check receiptString not reused
      if (hand.lineup[pos].last === receiptString) {
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
      hand.lineup[pos].last = receiptString;
      if (receipt.type === Type.SHOW) {
        hand.lineup[pos].cards = cards;
      }
      if (hand.lineup[pos].sitout === 'allin') {
        delete hand.lineup[pos].sitout;
      }
      // update db
      const changed = now();
      return this.db.updateSeat(tableAddr, hand.handId, hand.lineup[pos], pos, hand.state, changed);
    }).then(() => Promise.resolve(dist));
  }

  async leave(tableAddr, receiptString) {
    const receipt = this.rc.get(receiptString);
    const { leaverAddr } = receipt;
    // check if this hand exists
    const hand = await this.db.getLastHand(tableAddr);

    if (hand.type !== 'tournament') {
      const minHandId = (hand.state === 'waiting') ? hand.handId - 1 : hand.handId;
      if (receipt.handId < minHandId) {
        throw new BadRequest(`forbidden to exit at handId ${receipt.handId}`);
      }
    }

    // check signer in lineup
    const { lineup } = await this.contract.getLineup(tableAddr);
    const pos = lineup.findIndex(seat => seat.address === leaverAddr);
    if (pos < 0 || !hand.lineup[pos]) {
      throw new Forbidden(`address ${leaverAddr} not in lineup.`);
    }

    // set sitout if next hand started after leave receipt
    hand.lineup[pos].sitout = 1;

    if (hand.type !== 'tournament') {
      const minHandId = (hand.state === 'waiting') ? hand.handId - 1 : hand.handId;
      if (receipt.handId < minHandId) {
        throw new BadRequest(`forbidden to exit at handId ${receipt.handId}`);
      }

      // check signer not submitting another leave receipt
      if (hand.lineup[pos].exitHand) {
        throw new Forbidden(`exitHand ${hand.lineup[pos].exitHand} already set.`);
      }

      const exitHand = calcLeaveExitHand(this.helper, hand, receipt);
      return this.db.updateLeave(
        tableAddr,
        hand.handId,
        pos,
        exitHand,
        hand.lineup[pos].sitout,
        now(),
      );
    }

    return this.db.updateLeave(
      tableAddr,
      hand.handId,
      pos,
      undefined, // exitHand
      hand.lineup[pos].sitout,
      now(),
    );
  }

  netting(tableAddr, handIdStr, nettingSig) {
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
  }

  async timeout(tableAddr) {
    // get the latest hand to check on
    const hand = await this.db.getLastHand(tableAddr);
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
        return `could not find next player to act in hand ${hand.handId}`;
      }
    }

    const leftTime = (hand.changed + this.getTimeout(hand.state)) - now();
    if (leftTime > 0) {
      return `player ${pos} still got ${leftTime} seconds to act.`;
    }

    // allow a single player to sit at the table
    const activeCount = this.helper.countActivePlayers(hand.lineup, hand.state);

    const fiveMinutesAgo = now(-60 * 5);
    if (activeCount === 1 && hand.state === 'waiting' && hand.changed > fiveMinutesAgo) {
      return Promise.resolve();
    }

    // several players at the table and player didn't act timely — put him in sit out
    hand.lineup[pos].sitout = now();
    return this.updateState(tableAddr, hand, pos);
  }

  async lineup(tableAddr) {
    const [{ lastHandNetted, lineup }, defaultSmallBlind, hand] = await Promise.all([
      this.contract.getLineup(tableAddr),
      this.contract.getSmallBlind(tableAddr, 0),
      this.db.getLastHand(tableAddr),
    ]);

    if (lastHandNetted > hand.handId) {
      return Promise.reject(`contract handId ${lastHandNetted} ahead of table handId ${hand.handId}`);
    }
    if (!hand.lineup || hand.lineup.length !== lineup.length) {
      return Promise.reject(`table lineup length ${hand.lineup.length} does not match contract.`);
    }

    const joinPos = (
      hand.lineup.map((_, i) => i)
          .filter(i => seatIsEmpty(hand.lineup[i]) && !seatIsEmpty(lineup[i]))
          .map(i => ({ pos: i, addr: lineup[i].address }))
    );
    const leavePos = (
      hand.lineup.map((_, i) => i)
          .filter(i => !seatIsEmpty(hand.lineup[i]) && seatIsEmpty(lineup[i]))
    );

    if (leavePos.length === 0 && joinPos.length === 0) {
      return 'no changes for lineup detected.';
    }

    const getDealer = () => {
      if (hand.state === 'waiting' && !this.helper.isActivePlayer(hand.lineup, hand.dealer, hand.state)) {
        return joinPos.length > 0 ? joinPos[0].pos : getNextDealer(this.helper, hand);
      }

      return hand.dealer;
    };

    const sitout = ( // put new players at sitout if the hand in progress
      (hand.state !== 'waiting' && hand.state !== 'dealing')
      ? now()
      : undefined
    );
    const dealer = getDealer();
    const updatedHand = emulateSeatsUpdate(hand, joinPos, leavePos, dealer, sitout, now());
    const activeCount = this.helper.countActivePlayers(hand.lineup, hand.state);
    const nextActiveCount = this.helper.countActivePlayers(updatedHand.lineup, updatedHand.state);
    const isStart = hand.state === 'waiting' && activeCount < 2 && nextActiveCount >= 2;
    const isEnd = hand.state === 'waiting' && nextActiveCount < 2;

    console.log('lineup sb', {
      extra: {
        isEnd,
        sb: isEnd ? defaultSmallBlind : hand.sb,
        defaultSmallBlind,
        handSb: hand.sb,
      },
    });
    await this.db.updateSeats(
      tableAddr,
      hand.handId,
      joinPos,
      leavePos,
      dealer,
      isEnd ? defaultSmallBlind : hand.sb,
      sitout,
      now(), // changed
      isStart ? now() : hand.started, // started
    );

    this.logger.log(`removed players ${JSON.stringify(leavePos)}, added players ${JSON.stringify(joinPos)} in db`, {
      tags: { tableAddr, handId: hand.handId },
    });

    return undefined;
  }

  async callOpponent(tableAddr, webhookUrl, template) {
    try {
      const req = await this.db.getOpponentCallRequest(tableAddr);
      const fiveMinsAgo = Math.round(Date.now() / 1000) - 300;
      if (!req || (req && (Number(req.created) < fiveMinsAgo))) {
        await this.db.addOpponentCallRequest(tableAddr);
        // send message to discord
        return new Promise((resolve, reject) => {
          request.post(webhookUrl, {
            body: {
              username: 'OppBot',
              content: template.split('${tableAddr}').join(tableAddr), // eslint-disable-line no-template-curly-in-string
            },
            json: true,
          }, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      }

      return true;
    } catch (err) {
      return this.logger.exception(err);
    }
  }
}

module.exports = TableManager;
