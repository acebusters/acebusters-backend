import ethUtil from 'ethereumjs-util';
import 'buffer-v6-polyfill';
import crypto from 'crypto';
import BigNumber from 'bignumber.js';
import { PokerHelper, Receipt, ReceiptCache } from 'poker-helper';

const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';

const NTZ_DECIMAL = new BigNumber(10).pow(12);
function babz(ntz) {
  return new BigNumber(ntz).mul(NTZ_DECIMAL);
}

function now(secs = 0) {
  return Math.floor(Date.now() / 1000) + secs;
}

const shuffle = function shuffle() {
  const array = [];
  for (let i = 0; i < 52; i += 1) {
    array.push(i);
  }
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = crypto.randomBytes(1)[0] % i;
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
  return array;
};

function EventWorker(
  table,
  db,
  oraclePriv,
  logger,
  recoveryPriv,
  mailer,
  oracle,
  pusher,
) {
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

EventWorker.prototype.process = function process(msg) {
  const tasks = [];

  if (!msg.Subject || msg.Subject.split('::').length < 2) {
    throw new Error(`unknown message type: ${msg.Subject}`);
  }
  let msgBody;
  try {
    msgBody = (msg.Message && msg.Message.length > 0) ? JSON.parse(msg.Message) : '';
  } catch (e) {
    throw new Error(`json parse error: ${JSON.stringify(e)}`);
  }
  const msgType = msg.Subject.split('::')[0];

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
};

EventWorker.prototype.addPromoAllowace = async function addPromoAllowace(refCode, value) {
  const referral = await this.db.getReferral(refCode);
  return this.db.setAllowance(refCode, referral.allowance + Number(value));
};

EventWorker.prototype.publishUpdate = function publishUpdate(topic, msg) {
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
};

EventWorker.prototype.walletCreated = function walletCreated(email) {
  return this.mailer.add(email);
};

EventWorker.prototype.submitLeave = function submitLeave(tableAddr, leaverAddr, exitHand) {
  const leaveReceipt = new Receipt(tableAddr).leave(exitHand, leaverAddr).sign(this.oraclePriv);
  try {
    const leaveHex = Receipt.parseToParams(leaveReceipt);
    return this.table.leave(tableAddr, leaveHex).then(
      (txHash) => {
        this.logger.log('tx: table.leave()', {
          tags: { tableAddr, handId: exitHand },
          extra: { leaveReceipt },
        });

        return [txHash];
      },
      error => this.logger.log('tx: table.leave()', {
        level: 'error',
        tags: { tableAddr, handId: exitHand },
        extra: { error, leaveReceipt },
      }),
    );
  } catch (error) {
    return Promise.reject(error);
  }
};

EventWorker.prototype.kickPlayer = function kickPlayer(tableAddr, pos) {
  let hand;
  let handId;
  const lineupProm = this.table.getLineup(tableAddr);
  const lastHandProm = this.db.getLastHand(tableAddr);
  return Promise.all([lineupProm, lastHandProm]).then((rsps) => {
    const lineup = rsps[0].lineup;
    hand = rsps[1];
    if (typeof pos === 'undefined' || pos > hand.lineup.length) {
      throw new Error(`pos ${pos} could not be found to kick.`);
    }
    const addr = hand.lineup[pos].address;
    let found = false;
    for (let i = 0; i < lineup.length; i += 1) {
      if (lineup[i].address === addr) {
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error(`player ${addr} not in lineup.`);
    }
    // check if on sitout for more than 5 minutes
    const old = now(-5 * 60);
    if (!hand.lineup[pos].sitout || typeof hand.lineup[pos].sitout !== 'number' ||
      hand.lineup[pos].sitout > old) {
      throw new Error(`player ${addr} still got ${hand.lineup[pos].sitout - old} seconds to sit out, not yet to be kicked.`);
    }
    handId = (hand.state === 'waiting') ? hand.handId - 1 : hand.handId;
    return this.submitLeave(tableAddr, addr, handId);
  }).then(() => this.db.updateSeatLeave(tableAddr, handId, pos, now()));
};

EventWorker.prototype.progressNetting = function progressNetting(tableAddr) {
  return this.table.net(tableAddr).then(
    () => this.logger.log('tx: table.net()', {
      tags: { tableAddr },
    }),
    error => this.logger.log('tx: table.net()', {
      tags: { tableAddr },
      level: 'error',
      extra: { error },
    }),
  );
};

function range(s, e) {
  return Array.from(new Array((e - s) + 1), (_, i) => i + s);
}

function identity(a) {
  return a;
}

EventWorker.prototype.handleDispute = async function handleDispute(
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
};

EventWorker.prototype.deleteHands = async function deleteHands(tableAddr) {
  const [{ lastHandNetted: lhn }, hand] = await Promise.all([
    this.table.getLineup(tableAddr),
    this.db.getLastHand(tableAddr, true),
  ]);

  if (lhn < 2 || hand.handId > lhn) {
    return `no work on range lhn: ${lhn} , handId: ${hand.handId}`;
  }

  const deletes = [];
  for (let i = hand.handId; i < lhn; i += 1) {
    deletes.push(this.db.deleteHand(tableAddr, i));
  }

  return Promise.all(deletes);
};

EventWorker.prototype.settleTable = function settleTable(tableAddr, sigs, hand) {
  return this.table.settle(tableAddr, sigs, hand.netting.newBalances)
    .then(
     () => {
       this.logger.log('tx: table.settle()', {
         tags: { tableAddr },
         extra: { bals: hand.netting.newBalances, sigs },
       });
       return this.db.markHandAsNetted(tableAddr, hand.handId);
     },
     error => this.logger.log('tx: table.settle()', {
       tags: { tableAddr },
       level: 'error',
       extra: { bals: hand.netting.newBalances, sigs, error },
     }),
    );
};

EventWorker.prototype.submitNetting = function submitNetting(tableAddr, handId) {
  let sigs = '0x';
  return this.db.getHand(tableAddr, handId).then((hand) => {
    if (hand.is_netted) return Promise.resolve();
    Object.keys(hand.netting).forEach((addr) => {
      if (addr !== 'newBalances') {
        sigs += hand.netting[addr].replace('0x', '');
      }
    });
    return this.settleTable(tableAddr, sigs, hand);
  });
};

EventWorker.prototype.createNetting = function createNetting(tableAddr, handId) {
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
};

EventWorker.prototype.toggleTable = function toggleTable(tableAddr) {
  const lhnProm = this.table.getLastHandNetted(tableAddr);
  return Promise.all([lhnProm]).then((responses) => {
    const lhn = responses[0];
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
  });
};

EventWorker.prototype.addPlayer = function addPlayer(tableAddr) {
  // call lineup on oracle
  return this.oracle.lineup(tableAddr);
};

EventWorker.prototype.removePlayer = function removePlayer(tableAddr) {
  // call lineup on oracle
  return this.oracle.lineup(tableAddr);
};

EventWorker.prototype.timeout = function timeout(tableAddr) {
  // call timeout on oracle
  return this.oracle.timeout(tableAddr);
};

EventWorker.prototype.getBalances = function getBalances(tableAddr, lineup, lhn, handId) {
  const balances = { };
  for (let pos = 0; pos < lineup.length; pos += 1) {
    if (lineup[pos].address !== EMPTY_ADDR) {
      balances[lineup[pos].address] = lineup[pos].amount;
    }
  }
  if (lhn >= handId - 1) {
    return Promise.resolve(balances);
  }
  const handProms = [];
  for (let i = lhn + 1; i < handId; i += 1) {
    handProms.push(this.db.getHand(tableAddr, i));
  }
  return Promise.all(handProms).then((hands) => {
    // sum up previous hands
    for (let i = 0; i < hands.length; i += 1) {
      const distribution = this.rc.get(hands[i].distribution);
      const outs = distribution ? distribution.outs : [];
      for (let pos = 0; pos < hands[i].lineup.length; pos += 1) {
        if (hands[i].lineup[pos].last) {
          if (typeof outs[pos] === 'undefined') {
            outs[pos] = new BigNumber(0);
          }
          const value = this.rc.get(hands[i].lineup[pos].last).amount;
          const bal = balances[hands[i].lineup[pos].address] || new BigNumber(0);
          balances[hands[i].lineup[pos].address] = bal.add(outs[pos]).sub(value);
        }
      }
    }
    return Promise.resolve(balances);
  });
};

EventWorker.prototype.calcDistribution = function calcDistribution(tableAddr, hand) {
  if (!hand.deck) {
    return Promise.reject(`hand ${hand} at table ${tableAddr} invalid.`);
  }
  const boardCards = hand.deck.slice(20, 25);
  const rakePerMil = 10;
  const winners = this.helper.calcDistribution(hand.lineup,
    hand.state, boardCards, rakePerMil, this.oracleAddr);
  // distribute pots
  const outs = [];
  for (let i = 0; i < hand.lineup.length; i += 1) {
    outs.push(
      winners[hand.lineup[i].address]
        ? new BigNumber(winners[hand.lineup[i].address])
        : babz(0),
    );
  }
  let claimId = 0;
  if (hand.distribution) {
    claimId = this.rc.get(hand.distribution).claimId + 1;
  }
  const dist = new Receipt(tableAddr).dist(hand.handId, claimId, outs).sign(this.oraclePriv);
  return this.db.updateDistribution(tableAddr, hand.handId, dist).then(() => {
    this.logger.log(`HandComplete: ${tableAddr}`, {
      level: 'info',
      tags: {
        tableAddr,
        handId: hand.handId,
      },
      extra: { dist, hand },
    });
    return dist;
  });
};

EventWorker.prototype.putNextHand = function putNextHand(tableAddr) {
  let prevHand;
  let lineup;
  let smallBlind;
  let balances;
  const hand = this.db.getLastHand(tableAddr);
  const table = this.table.getLineup(tableAddr);
  const sb = this.table.getSmallBlind(tableAddr);
  return Promise.all([hand, table, sb]).then((rsp) => {
    prevHand = rsp[0];
    lineup = rsp[1].lineup;
    smallBlind = rsp[2];
    let distProm;
    if (!prevHand.distribution) {
      distProm = this.calcDistribution(tableAddr, prevHand);
    } else {
      distProm = Promise.resolve(prevHand.distribution);
    }
    // return get all old hands
    const balProm = this.getBalances(tableAddr, lineup, rsp[1].lastHandNetted, prevHand.handId);
    return Promise.all([balProm, distProm]);
  }).then((rsp) => {
    balances = rsp[0];
    prevHand.distribution = rsp[1];

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
        // at timestamp of last hand, so he has some time
        // to rebuy
        if (balances[lineup[i].address] < smallBlind * 2) {
          lineup[i].sitout = prevHand.changed;
        }
      }
    }
    const prevDealer = (typeof prevHand.dealer !== 'undefined') ? (prevHand.dealer + 1) : 0;
    const newDealer = this.helper.nextPlayer(lineup, prevDealer, 'involved', 'waiting');
    const deck = shuffle();
    const changed = now();
    return this.db.putHand(tableAddr, prevHand.handId + 1,
      lineup, newDealer, deck, smallBlind, changed);
  }).then(() => this.logger.log(`NewHand: ${tableAddr}`, {
    level: 'info',
    tags: {
      tableAddr,
      handId: prevHand.handId + 1,
    },
    extra: lineup,
  }))
  .catch((error) => {
    if (!error.indexOf || error.indexOf('Not Found') === -1) {
      throw error;
    }
    const sbProm = this.table.getSmallBlind(tableAddr);
    const lineupProm = this.table.getLineup(tableAddr);
    let lastHandNetted;
    return Promise.all([sbProm, lineupProm]).then((rsp) => {
      smallBlind = rsp[0];
      lineup = rsp[1].lineup;
      lastHandNetted = rsp[1].lastHandNetted;
      for (let i = 0; i < lineup.length; i += 1) {
        delete lineup[i].amount;
        delete lineup[i].exitHand;
      }
      const deck = shuffle();
      const changed = now();
      return this.db.putHand(tableAddr, rsp[1].lastHandNetted + 1,
        lineup, 0, deck, smallBlind, changed);
    }).then(() => this.logger.log(`NewHand: ${tableAddr}`, {
      level: 'info',
      tags: {
        tableAddr,
        handId: lastHandNetted + 1,
      },
      extra: lineup,
    }));
  });
};

module.exports = EventWorker;
