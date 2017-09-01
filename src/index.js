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
  factory,
  db,
  oraclePriv,
  sentry,
  recoveryPriv,
  mailer,
  oracle,
  pusher,
) {
  this.table = table;
  this.factory = factory;
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
  this.sentry = sentry;
  this.mailer = mailer;
  this.oracle = oracle;
  this.pusher = pusher;
  this.rc = new ReceiptCache();
}

EventWorker.prototype.process = function process(msg) {
  const tasks = [];

  if (!msg.Subject || msg.Subject.split('::').length < 2) {
    return [Promise.resolve(`unknown message type: ${msg.Subject}`)];
  }
  let msgBody;
  try {
    msgBody = (msg.Message && msg.Message.length > 0) ? JSON.parse(msg.Message) : '';
  } catch (e) {
    return [Promise.resolve(`json parse error: ${JSON.stringify(e)}`)];
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
    tasks.push(this.walletCreated(msgBody.signerAddr, msgBody.email));
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

  // nothing to do
  return tasks;
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

EventWorker.prototype.err = function err(e) {
  this.sentry.captureException(e, { server_name: 'event-worker' }, (sendErr) => {
    if (sendErr) {
      console.error(`Failed to send captured exception to Sentry: ${sendErr}`); // eslint-disable-line  no-console
    }
  });
  return e;
};

EventWorker.prototype.log = function log(message, context) {
  const cntxt = (context) || {};
  cntxt.level = (cntxt.level) ? cntxt.level : 'info';
  cntxt.server_name = 'event-worker';
  return new Promise((fulfill, reject) => {
    const now = Math.floor(Date.now() / 1000);
    this.sentry.captureMessage(`${now} - ${message}`, cntxt, (error, eventId) => {
      if (error) {
        reject(error);
        return;
      }
      fulfill(eventId);
    });
  });
};

EventWorker.prototype.walletCreated = function walletCreated(signerAddr, email) {
  return this.factory.createAccount(signerAddr, this.recoveryAddr)
    .then(() => this.mailer.add(email))
    .then(() => this.log(`WalletCreated: ${signerAddr}`, {
      user: {
        id: signerAddr,
      },
    }));
};

EventWorker.prototype.submitLeave = function submitLeave(tableAddr, leaverAddr, exitHand) {
  let leaveHex;
  const leaveReceipt = new Receipt(tableAddr).leave(exitHand, leaverAddr).sign(this.oraclePriv);
  try {
    leaveHex = Receipt.parseToParams(leaveReceipt);
  } catch (error) {
    return Promise.reject(error);
  }
  return this.table.leave(tableAddr, leaveHex).then(
    (txHash) => {
      this.log('tx: table.leave()', {
        tags: { tableAddr, handId: exitHand },
        extra: { leaveReceipt },
      });

      return [txHash];
    },
    error => this.log('tx: table.leave()', {
      level: 'error',
      extra: { error, leaveReceipt },
    }),
  );
};

EventWorker.prototype.kickPlayer = function kickPlayer(tableAddr, pos) {
  let hand;
  const lineupProm = this.table.getLineup(tableAddr);
  const lastHandProm = this.db.getLastHand(tableAddr);
  return Promise.all([lineupProm, lastHandProm]).then((rsps) => {
    const lineup = rsps[0].lineup;
    hand = rsps[1];
    if (typeof pos === 'undefined' || pos > hand.lineup.length) {
      return Promise.reject(`pos ${pos} could not be found to kick.`);
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
      return Promise.reject(`player ${addr} not in lineup.`);
    }
    // check if on sitout for more than 5 minutes
    const old = Math.floor(Date.now() / 1000) - (5 * 60);
    if (!hand.lineup[pos].sitout || typeof hand.lineup[pos].sitout !== 'number' ||
      hand.lineup[pos].sitout > old) {
      return Promise.reject(`player ${addr} still got ${hand.lineup[pos].sitout - old} seconds to sit out, not yet to be kicked.`);
    }
    const handId = (hand.state === 'waiting') ? hand.handId - 1 : hand.handId;
    return this.submitLeave(tableAddr, addr, handId);
    // TODO: set exitHand flag in db?
  });
};

EventWorker.prototype.progressNetting = function progressNetting(tableAddr) {
  return this.table.net(tableAddr).then(
    () => this.log('tx: table.net()', {
      tags: { tableAddr },
    }),
    error => this.log('tx: table.net()', {
      tags: { tableAddr },
      level: 'error',
      extra: { error },
    }),
  );
};

EventWorker.prototype.handleDispute = function handleDispute(tableAddr,
  lastHandNetted, lastNettingRequest) {
  const bets = [];
  const dists = [];
  const handProms = [];
  let receipts = [];
  for (let i = lastHandNetted + 1; i <= lastNettingRequest; i += 1) {
    handProms.push(this.db.getHand(tableAddr, i));
  }
  return Promise.all(handProms).then((hands) => {
    let i;
    let pos;
    // sum up previous hands
    for (i = 0; i < hands.length; i += 1) {
      for (pos = 0; pos < hands[i].lineup.length; pos += 1) {
        if (hands[i].lineup[pos].last) {
          bets.push(hands[i].lineup[pos].last);
        }
      }
      if (hands[i].distribution) {
        dists.push(hands[i].distribution);
      }
    }
    for (i = 0; i < bets.length; i += 1) {
      receipts = receipts.concat(Receipt.parseToParams(bets[i]));
    }
    for (i = 0; i < dists.length; i += 1) {
      receipts = receipts.concat(Receipt.parseToParams(dists[i]));
    }

    return this.table.submit(tableAddr, receipts);
  }).then(
    (txHash) => {
      this.log('tx: table.submit()', {
        tags: { tableAddr },
        extra: { txHash, receipts },
      });
      return [txHash];
    },
    error => this.log('tx: table.submit()', {
      tags: { tableAddr },
      level: 'error',
      extra: { error, receipts },
    }),
  );
};

EventWorker.prototype.deleteHands = function deleteHands(tableAddr) {
  return this.table.getLineup(tableAddr).then(rsp => Promise.all([
    rsp.lastHandNetted,
    this.db.getLastHand(tableAddr, true),
  ])).then(([lhn, hand]) => {
    if (lhn < 2 || hand.handId > lhn) {
      return Promise.resolve(`no work on range lhn: ${lhn} , handId: ${hand.handId}`);
    }
    const deletes = [];
    for (let i = hand.handId; i <= lhn; i += 1) {
      deletes.push(this.db.deleteHand(tableAddr, i));
    }
    return Promise.all(deletes);
  });
};

EventWorker.prototype.submitNetting = function submitNetting(tableAddr, handId) {
  let hand;
  let sigs = '0x';
  return this.db.getHand(tableAddr, handId).then((_hand) => {
    hand = _hand;
    Object.keys(hand.netting).forEach((addr) => {
      if (addr !== 'newBalances') {
        sigs += hand.netting[addr].replace('0x', '');
      }
    });
    return this.table.settle(tableAddr, sigs, hand.netting.newBalances);
  }).then(
    () => this.log('tx: table.settle()', {
      tags: { tableAddr },
      extra: { bals: hand.netting.newBalances, sigs },
    }),
    error => this.log('tx: table.settle()', {
      tags: { tableAddr },
      level: 'error',
      extra: { bals: hand.netting.newBalances, sigs, error },
    }),
  );
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
    this.log(`HandComplete: ${tableAddr}`, {
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
    const changed = Math.floor(Date.now() / 1000);
    return this.db.putHand(tableAddr, prevHand.handId + 1,
      lineup, newDealer, deck, smallBlind, changed);
  }).then(() => this.log(`NewHand: ${tableAddr}`, {
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
      const changed = Math.floor(Date.now() / 1000);
      return this.db.putHand(tableAddr, rsp[1].lastHandNetted + 1,
        lineup, 0, deck, smallBlind, changed);
    }).then(() => this.log(`NewHand: ${tableAddr}`, {
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
