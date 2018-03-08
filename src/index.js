import ethUtil from 'ethereumjs-util';
import 'buffer-v6-polyfill';
import BigNumber from 'bignumber.js';
import { PokerHelper, Receipt, ReceiptCache } from 'poker-helper';
import {
  parseMessage,
  now,
  range,
  identity,
  not,
  isEmpty,
  hasReceipt,
  delay,
  shuffle,
  EMPTY_ADDR,
} from './utils';

class EventWorker {
  constructor(
    table,
    db,
    oraclePriv,
    logger,
    recoveryPriv,
    mailer,
    oracle,
    pusher,
    showdownDelay = 0,
  ) {
    this.showdownDelay = showdownDelay;
    this.table = table;
    this.db = db;
    if (oraclePriv) {
      this.oraclePriv = oraclePriv;
      const priv = new Buffer(oraclePriv.replace('0x', ''), 'hex');
      this.oracleAddr = `0x${ethUtil.privateToAddress(priv).toString('hex')}`;
    }
    if (recoveryPriv) {
      this.recoveryPriv = recoveryPriv;
      const recPrivBuf = new Buffer(recoveryPriv.replace('0x', ''), 'hex');
      this.recoveryAddr = `0x${ethUtil.privateToAddress(recPrivBuf).toString('hex')}`;
    }
    this.helper = new PokerHelper();
    this.logger = logger;
    this.mailer = mailer;
    this.oracle = oracle;
    this.pusher = pusher;
    this.rc = new ReceiptCache();
  }

  process(msg) {
    const { msgType, msgBody } = parseMessage(msg);
    const tasks = [];

    // handle TableLeave event:
    // fordward receipt signed by oracle to table.
    if (msgType === 'TableLeave') {
      tasks.push(this.submitLeave(msgBody.tableAddr, msgBody.leaverAddr, msgBody.exitHand));
    }

    // have the table propress in netting
    // call the net function for that
    if (msgType === 'ProgressNetting') {
      tasks.push(this.progressNetting(msg.Subject.split('::')[1]));
    }

    // this is where we take all receipt and distributions
    // and send them to the contract to net
    if (msgType === 'HandleDispute') {
      tasks.push(this.handleDispute(msgBody.tableAddr,
        msgBody.lastHandNetted, msgBody.lastNettingRequest));
    }

    // handle HandComplete event:
    if (msgType === 'HandComplete') {
      tasks.push(this.putNextHand(msg.Subject.split('::')[1]));
    }

    // handle Timeout event:
    if (msgType === 'Timeout') {
      tasks.push(this.timeout(msg.Subject.split('::')[1]));
    }

    // handle TableNettingRequest:
    // we start preparing the netting in db.
    // create netting, sign by oracle, wait for others
    if (msgType === 'TableNettingRequest') {
      tasks.push(this.createNetting(msgBody.tableAddr, msgBody.handId));
    }

    // handle TableNettingComplete, when everyone has signed
    // in db, forward netting to settle() function in table.
    if (msgType === 'TableNettingComplete') {
      tasks.push(this.submitNetting(msgBody.tableAddr, msgBody.handId));
    }

    // react to new wallet. deploy proxy on the chain.
    if (msgType === 'WalletCreated') {
      tasks.push(this.walletCreated(msgBody.email));
    }

    // toggle table active
    if (msgType === 'ToggleTable') {
      tasks.push(this.toggleTable(msg.Subject.split('::')[1]));
    }

    // kick a player from a table.
    if (msgType === 'Kick') {
      tasks.push(this.kickPlayer(msgBody.tableAddr, msgBody.pos));
    }

    // react to Netting event in table contract:
    // find all players that have lastHand == lastHandNetted
    // pay out those players
    if (msgType === 'ContractEvent' && msgBody.event === 'Netted') {
      tasks.push(this.deleteHands(msgBody.address));
    }

    // react to Join event in table contract:
    // find new player and add to lineup in dynamo
    if (msgType === 'ContractEvent' && msgBody.event === 'Join') {
      tasks.push(this.addPlayer(msgBody.address));
    }

    // react to Leave event in table contract:
    // find player and from lineup in dynamo
    if (msgType === 'ContractEvent' && msgBody.event === 'Leave') {
      tasks.push(this.removePlayer(msgBody.address));
    }

    if (msgType === 'AddPromo') {
      tasks.push(this.addPromoAllowace(...msg.Subject.split('::').slice(1)));
    }

    // nothing to do
    return tasks;
  }

  async addPromoAllowace(refCode, value) {
    const referral = await this.db.getReferral(refCode);
    return this.db.setAllowance(refCode, referral.allowance + Number(value));
  }

  publishUpdate(topic, msg) {
    return new Promise((fulfill, reject) => {
      try {
        const rsp = this.pusher.trigger(topic, 'update', {
          type: 'txHash',
          payload: msg,
        });
        fulfill(rsp);
      } catch (err) {
        reject(err);
      }
    });
  }

  walletCreated(email) {
    return this.mailer.add(email);
  }

  async submitLeave(tableAddr, leaverAddr, exitHand) {
    const leaveReceipt = new Receipt(tableAddr).leave(exitHand, leaverAddr).sign(this.oraclePriv);
    try {
      const leaveHex = Receipt.parseToParams(leaveReceipt);
      await this.table.leave(tableAddr, leaveHex);
      this.logger.log('tx: table.leave()', {
        tags: { tableAddr, handId: exitHand },
        extra: { leaveReceipt },
      });
    } catch (error) {
      this.logger.log('tx: table.leave()', {
        level: 'error',
        tags: { tableAddr, handId: exitHand },
        extra: { error, leaveReceipt },
      });
    }
  }

  async kickPlayer(tableAddr, pos) {
    const [{ lineup }, hand] = await Promise.all([
      this.table.getLineup(tableAddr),
      this.db.getLastHand(tableAddr),
    ]);
    if (typeof pos === 'undefined' || pos > hand.lineup.length) {
      throw new Error(`pos ${pos} could not be found to kick.`);
    }
    const { address, sitout } = hand.lineup[pos];

    if (!lineup.some(seat => seat.address === address)) {
      throw new Error(`player ${address} not in lineup of table ${tableAddr}`);
    }

    // check if on sitout for more than 5 minutes
    if (!sitout || typeof sitout !== 'number' || sitout > now(-5 * 60)) {
      throw new Error(`player ${address} still got ${sitout - now(-5 * 60)} seconds to sit out, not yet to be kicked.`);
    }

    const handId = (hand.state === 'waiting') ? hand.handId - 1 : hand.handId;
    await this.submitLeave(tableAddr, address, handId);

    return this.db.updateSeatLeave(tableAddr, handId, pos, now());
  }

  async progressNetting(tableAddr) {
    try {
      await this.table.net(tableAddr);
      this.logger.log('tx: table.net()', {
        tags: { tableAddr },
      });
    } catch (error) {
      this.logger.log('tx: table.net()', {
        tags: { tableAddr },
        level: 'error',
        extra: { error },
      });
    }
  }

  async handleDispute(
    tableAddr,
    lastHandNetted,
    lastNettingRequest,
  ) {
    const hands = await Promise.all(
      range(lastHandNetted + 1, lastNettingRequest)
        .map(i => this.db.getHand(tableAddr, i)),
    );

    const bets = [].concat(
      ...hands.map(hand => hand.lineup.map(seat => seat.last).filter(identity)),
    );
    const dists = hands.map(hand => hand.distribution).filter(identity);
    const receipts = [].concat(...bets.concat(dists).map(r => Receipt.parseToParams(r)));

    try {
      await this.table.submit(tableAddr, receipts);
      this.logger.log('tx: table.submit()', {
        tags: { tableAddr },
        extra: { receipts },
      });
    } catch (error) {
      this.logger.log('tx: table.submit()', {
        tags: { tableAddr },
        level: 'error',
        extra: { error, receipts },
      });
    }
  }

  async deleteHands(tableAddr) {
    const [{ lastHandNetted: lhn }, hand] = await Promise.all([
      this.table.getLineup(tableAddr),
      this.db.getLastHand(tableAddr, true),
    ]);

    if (lhn < 2 || hand.handId > lhn) {
      return `no work on range lhn: ${lhn} , handId: ${hand.handId}`;
    }

    return Promise.all(
      range(hand.handId, lhn - 1)
        .map(i => this.db.deleteHand(tableAddr, i)),
    );
  }

  async settleTable(tableAddr, sigs, hand) {
    try {
      await this.table.settle(tableAddr, sigs, hand.netting.newBalances);
      await this.logger.log('tx: table.settle()', {
        tags: { tableAddr },
        extra: { bals: hand.netting.newBalances, sigs },
      });
      return this.db.markHandAsNetted(tableAddr, hand.handId);
    } catch (error) {
      return this.logger.log('tx: table.settle()', {
        tags: { tableAddr },
        level: 'error',
        extra: { bals: hand.netting.newBalances, sigs, error },
      });
    }
  }

  async submitNetting(tableAddr, handId) {
    const hand = await this.db.getHand(tableAddr, handId);
    if (hand.is_netted) {
      return undefined;
    }

    const sigs = (
      Object.keys(hand.netting)
        .filter(addr => addr !== 'newBalances')
        .reduce((memo, addr) => memo + hand.netting[addr].replace('0x', ''), '0x')
    );
    return this.settleTable(tableAddr, sigs, hand);
  }

  createNetting(tableAddr, handId) {
    const old = [];
    const bal = [];
    let lhn;
    return this.table.getLineup(tableAddr).then((rsp) => {
      for (let pos = 0; pos < rsp.lineup.length; pos += 1) {
        if (rsp.lineup[pos].address && rsp.lineup[pos].address !== EMPTY_ADDR) {
          bal[pos] = rsp.lineup[pos].amount;
          old[pos] = rsp.lineup[pos].amount;
        } else {
          bal[pos] = new BigNumber(0);
          old[pos] = new BigNumber(0);
        }
      }
      // return get all old hands
      const hands = [];
      lhn = rsp.lastHandNetted;
      for (let i = rsp.lastHandNetted + 1; i <= handId; i += 1) {
        hands.push(this.db.getHand(tableAddr, i));
      }
      return Promise.all(hands);
    }).then((hands) => {
      if (hands.length === 0) {
        return Promise.resolve('netting not needed');
      }
      // prevent overwriting netting
      const lastHand = hands[hands.length - 1];
      if (lastHand.netting) {
        return Promise.resolve('netting already found');
      }
      // sum up previous hands
      for (let i = 0; i < hands.length; i += 1) {
        const distribution = this.rc.get(hands[i].distribution);
        const outs = distribution ? distribution.outs : [];
        for (let pos = 0; pos < hands[i].lineup.length; pos += 1) {
          if (hands[i].lineup[pos].last) {
            if (typeof outs[pos] === 'undefined') {
              outs[pos] = new BigNumber(0);
            }
            bal[pos] = bal[pos].add(outs[pos]).sub(this.rc.get(hands[i].lineup[pos].last).amount);
          }
        }
      }
      // build receipt
      for (let i = 0; i < bal.length; i += 1) {
        bal[i] = bal[i].sub(old[i]);
      }
      const settleReceipt = new Receipt(tableAddr).settle(lhn, handId, bal).sign(this.oraclePriv);
      const bytes = Receipt.parseToParams(settleReceipt);
      // write netting
      return this.db.updateNetting(tableAddr, handId, {
        newBalances: `0x${bytes[1].replace('0x', '')}${bytes[2].replace('0x', '')}`,
        [this.oracleAddr]: bytes[0],
      });
    });
  }

  async toggleTable(tableAddr) {
    const lhn = await this.table.getLastHandNetted(tableAddr);
    const priv = new Buffer(this.oraclePriv.replace('0x', ''), 'hex');
    const callDest = new Buffer(tableAddr.replace('0x', ''), 'hex');
    const hand = Buffer.alloc(4);
    hand.writeUInt32BE(lhn, 0);
    const hash = ethUtil.sha3(Buffer.concat([hand, callDest]));
    const sig = ethUtil.ecsign(hash, priv);
    const activeReceipt = Buffer.alloc(89);
    hand.copy(activeReceipt, 0);
    callDest.copy(activeReceipt, 4);
    sig.r.copy(activeReceipt, 24);
    sig.s.copy(activeReceipt, 56);
    activeReceipt.writeInt8(sig.v, 88);
    return this.table.toggleTable(tableAddr, `0x${activeReceipt.toString('hex')}`);
  }

  addPlayer(tableAddr) {
    return this.oracle.lineup(tableAddr);
  }

  removePlayer(tableAddr) {
    return this.oracle.lineup(tableAddr);
  }

  timeout(tableAddr) {
    return this.oracle.timeout(tableAddr);
  }

  async getBalances(tableAddr, lineup, lhn, handId) {
    const balances = lineup.filter(not(isEmpty)).reduce((memo, seat) => ({
      ...memo,
      [seat.address]: seat.amount,
    }), {});

    if (lhn >= handId - 1) {
      return balances;
    }

    const hands = await this.db.getHandsRange(tableAddr, lhn + 1, handId);
    const zero = new BigNumber(0);
    return hands.reduce((bals, hand) => {
      const distribution = this.rc.get(hand.distribution);
      const outs = distribution ? distribution.outs : [];
      return hand.lineup.filter(hasReceipt).reduce((memo, seat, pos) => ({
        ...memo,
        [seat.address]: (
          (memo[seat.address] || zero)
            .add(outs[pos] || 0)
            .sub(this.rc.get(seat.last).amount)
        ),
      }), bals);
    }, balances);
  }

  async calcDistribution(tableAddr, hand) {
    if (!hand.deck) {
      throw new Error(`hand ${hand} at table ${tableAddr} invalid.`);
    }

    const winners = this.helper.calcDistribution(
      hand.lineup,
      hand.state,
      hand.deck.slice(20, 25), // board cards
      10, // rakePerMil
      this.oracleAddr,
    );

    // distribute pots
    const dist = new Receipt(tableAddr).dist(
      hand.handId,
      hand.distribution ? this.rc.get(hand.distribution).claimId + 1 : 0, // claimId
      hand.lineup.map(seat => new BigNumber(winners[seat.address] || 0)), // outs
    ).sign(this.oraclePriv);
    await this.db.updateDistribution(tableAddr, hand.handId, dist);
    await this.logger.log(`HandComplete: ${tableAddr}`, {
      level: 'info',
      tags: {
        tableAddr,
        handId: hand.handId,
      },
      extra: { dist, hand },
    });

    return dist;
  }

  async putNextHand(tableAddr) {
    const [{ lineup, lastHandNetted }, smallBlind] = await Promise.all([
      this.table.getLineup(tableAddr),
      this.table.getSmallBlind(tableAddr),
    ]);

    try {
      const prevHand = await this.db.getLastHand(tableAddr);

      // giving more time for showdown
      if (prevHand.state === 'showdown') {
        await delay(this.showdownDelay);
      }

      // return get all old hands
      const balances = await this.getBalances(tableAddr, lineup, lastHandNetted, prevHand.handId);

      prevHand.distribution = (
        prevHand.distribution || await this.calcDistribution(tableAddr, prevHand)
      );

      if (prevHand.distribution) {
        // sum up previous hands
        for (let pos = 0; pos < prevHand.lineup.length; pos += 1) {
          const distribution = this.rc.get(prevHand.distribution);
          const outs = distribution ? distribution.outs : [];
          if (prevHand.lineup[pos].last) {
            if (typeof outs[pos] === 'undefined') {
              outs[pos] = new BigNumber(0);
            }
            const value = this.rc.get(prevHand.lineup[pos].last).amount;
            const bal = balances[prevHand.lineup[pos].address] || new BigNumber(0);
            balances[prevHand.lineup[pos].address] = bal.add(outs[pos]).sub(value);
          }
        }
      }

      // create new lineup
      for (let i = 0; i < lineup.length; i += 1) {
        delete lineup[i].amount;
        if (lineup[i].exitHand <= 0) {
          delete lineup[i].exitHand;
        }
        if (prevHand.lineup[i] &&
          prevHand.lineup[i].address === lineup[i].address) {
          // ignore empty seats
          if (lineup[i].address === EMPTY_ADDR) {
            continue; // eslint-disable-line no-continue
          }
          // copy over all sitouts
          const sitout = prevHand.lineup[i].sitout;
          if (sitout && typeof sitout === 'number') {
            lineup[i].sitout = sitout;
          }
          // copy over all exitHands
          if (prevHand.lineup[i].exitHand) {
            lineup[i].exitHand = prevHand.lineup[i].exitHand;
          }
          // if player leaving, put into sitout
          if (prevHand.handId >= lineup[i].exitHand) {
            lineup[i].sitout = 1;
          }
          // if player broke, put into sitout
          // at now(), so he has some time to rebuy
          if (balances[lineup[i].address] < smallBlind * 2) {
            lineup[i].sitout = now();
          }
        }
      }

      const prevDealer = (typeof prevHand.dealer !== 'undefined') ? (prevHand.dealer + 1) : 0;
      const newDealer = this.helper.nextPlayer(lineup, prevDealer, 'involved', 'waiting');
      await this.db.putHand(
        tableAddr,
        prevHand.handId + 1,
        lineup,
        newDealer,
        shuffle(), // deck
        smallBlind,
        now(), // changed
      );
      return this.logger.log(`NewHand: ${tableAddr}`, {
        level: 'info',
        tags: {
          tableAddr,
          handId: prevHand.handId + 1,
        },
        extra: lineup,
      });
    } catch (error) {
      if (!error.indexOf || error.indexOf('Not Found') === -1) {
        throw error;
      }

      for (let i = 0; i < lineup.length; i += 1) {
        delete lineup[i].amount;
        delete lineup[i].exitHand;
      }
      const deck = shuffle();
      const changed = now();
      await this.db.putHand(tableAddr, lastHandNetted + 1, lineup, 0, deck, smallBlind, changed);

      return this.logger.log(`NewHand: ${tableAddr}`, {
        level: 'info',
        tags: {
          tableAddr,
          handId: lastHandNetted + 1,
        },
        extra: lineup,
      });
    }
  }
}


module.exports = EventWorker;
