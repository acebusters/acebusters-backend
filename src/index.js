import ethUtil from 'ethereumjs-util';
import EWT from 'ethereum-web-token';
import 'buffer-v6-polyfill';
import crypto from 'crypto';
import { PokerHelper, Receipt } from 'poker-helper';

const ABI_DIST = [{ name: 'distribution', type: 'function', inputs: [{ type: 'uint' }, { type: 'uint' }, { type: 'bytes32[]' }] }];

const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';

const sign = function sign(payload, privStr) {
  const priv = new Buffer(privStr.replace('0x', ''), 'hex');
  const hash = ethUtil.sha3(payload);
  const sig = ethUtil.ecsign(hash, priv);
  return sig.r.toString('hex') + sig.s.toString('hex') + sig.v.toString(16);
};

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

function EventWorker(table, factory, db,
  oraclePriv, sentry, controller, nutz, recoveryPriv, mailer, oracle) {
  this.table = table;
  this.factory = factory;
  this.controller = controller;
  this.nutz = nutz;
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

  // react to new wallet. deploy proxy and controller on the chain.
  if (msgType === 'WalletCreated') {
    tasks.push(this.walletCreated(msgBody.signerAddr, msgBody.email));
  }

  // react to wallet reset. send recovery transaction to controller.
  if (msgType === 'WalletReset') {
    tasks.push(this.walletReset(msgBody.oldSignerAddr, msgBody.newSignerAddr));
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
    tasks.push(this.payoutPlayers(msgBody.address));
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
  const nextAddrProm = this.factory.getNextAddr();
  const createProm = this.factory.createAccount(signerAddr, this.recoveryAddr);
  return Promise.all([nextAddrProm, createProm]).then((rsps) => {
    const nextAddr = rsps[0];
    const faucetProm = this.nutz.transfer(nextAddr, 1500000000000000);
    const mailerProm = this.mailer.add(email);
    return Promise.all([faucetProm, mailerProm]);
  }).then(() => this.log(`WalletCreated: ${signerAddr}`, {
    user: {
      id: signerAddr,
    },
  }));
};

EventWorker.prototype.walletReset = function walletReset(oldAddr, newAddr) {
  let recoveryReceipt;
  return this.factory.getAccount(oldAddr).then((rsp) => {
    recoveryReceipt = new Receipt(rsp.controller)
      .recover(rsp.lastNonce + 1, newAddr).sign(this.recoveryPriv);
    const recoveryHex = Receipt.parseToParams(recoveryReceipt);
    return this.controller.changeSigner(rsp.controller, recoveryHex);
  }).then(txHash => this.log(`tx: controller.changeSigner(${oldAddr}, ${newAddr})`, {
    extra: { txHash, recoveryReceipt, oldAddr, newAddr },
  }));
};

EventWorker.prototype.submitLeave = function submitLeave(tableAddr, leaverAddr, exitHand) {
  let leaveHex;
  let txHash;
  const leaveReceipt = new Receipt(tableAddr).leave(exitHand, leaverAddr).sign(this.oraclePriv);
  try {
    leaveHex = Receipt.parseToParams(leaveReceipt);
  } catch (error) {
    return Promise.reject(error);
  }
  return this.table.leave(tableAddr, leaveHex).then((_txHash) => {
    txHash = _txHash;
    const logProm = this.log('tx: table.leave()', {
      tags: { tableAddr, handId: exitHand },
      extra: { txHash, leaveReceipt },
    });
    const lineupProm = this.table.getLineup(tableAddr);
    return Promise.all([lineupProm, logProm]);
  }).then((rsp) => {
    if (rsp[0].lastHandNetted >= exitHand) {
      return this.table.payout(tableAddr, leaverAddr).then(_txHash => this.log('tx: table.payout()', {
        tags: { tableAddr },
        extra: {
          txHash: _txHash,
          leaverAddr,
        },
      }));
    }
    return Promise.resolve('');
  }).then(payoutHash => Promise.resolve([txHash, payoutHash]));
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
  return this.table.net(tableAddr).then(txHash => this.log('tx: table.net()', {
    tags: { tableAddr },
    extra: { txHash },
  }));
};

EventWorker.prototype.handleDispute = function handleDispute(tableAddr,
  lastHandNetted, lastNettingRequest) {
  const receipts = [];
  const dists = [];
  const handProms = [];
  let txHash;
  let txHash1;
  let betsHex = '0x';
  let betSigs = '0x';
  let distsHex = '0x';
  let distSigs = '0x';
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
          receipts.push(hands[i].lineup[pos].last);
        }
      }
      if (hands[i].distribution) {
        dists.push(hands[i].distribution);
      }
    }

    for (i = 0; i < receipts.length; i += 1) {
      const parsed = EWT.parseToHex(receipts[i]);
      betsHex += parsed.rec;
      betSigs += parsed.sig;
    }

    for (i = 0; i < dists.length; i += 1) {
      const parsed = EWT.parseToHex(dists[i]);
      distsHex += parsed.rec;
      distSigs += parsed.sig;
    }


    return this.table.submitDists(tableAddr, distsHex, distSigs);
  }).then((_txHash) => {
    txHash1 = _txHash;
    const logProm = this.log('tx: table.submitDists()', {
      tags: { tableAddr },
      extra: { txHash: txHash1, distsHex, distSigs },
    });
    const betsProm = this.table.submitBets(tableAddr, betsHex, betSigs);
    return Promise.all([betsProm, logProm]);
  }).then((rsp) => {
    txHash = rsp[0];
    return this.log('tx: table.submitBets()', {
      tags: { tableAddr },
      extra: { txHash, betsHex, betSigs },
    });
  })
  .then(() => Promise.resolve([txHash1, txHash]));
};

EventWorker.prototype.deleteHands = function deleteHands(tableAddr) {
  let lhn;
  return this.table.getLineup(tableAddr).then((rsp) => {
    lhn = rsp.lastHandNetted;
    return this.db.getLastHand(tableAddr, true);
  }).then((hand) => {
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

EventWorker.prototype.payoutPlayers = function payoutPlayers(tableAddr) {
  return this.table.getLineup(tableAddr).then((rsp) => {
    const requests = [];
    for (let pos = 0; pos < rsp.lineup.length; pos += 1) {
      if (rsp.lineup[pos].exitHand > 0 &&
        rsp.lineup[pos].exitHand <= rsp.lastHandNetted) {
        requests.push(this.table.payout(tableAddr, rsp.lineup[pos].address));
      }
    }
    return Promise.all(requests);
  }).then(txns =>
    // do anything more?
     Promise.resolve(txns));
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
    return this.table.settle(tableAddr, hand.netting.newBalances, sigs);
  }).then(txHash => this.log('tx: table.settle()', {
    tags: { tableAddr },
    extra: { bals: hand.netting.newBalances, sigs, txHash },
  }));
};

EventWorker.prototype.createNetting = function createNetting(tableAddr, handId) {
  const balances = { [this.oracleAddr]: 0 };
  return this.table.getLineup(tableAddr).then((rsp) => {
    for (let pos = 0; pos < rsp.lineup.length; pos += 1) {
      if (rsp.lineup[pos].address && rsp.lineup[pos].address !== EMPTY_ADDR) {
        balances[rsp.lineup[pos].address] = rsp.lineup[pos].amount;
      }
    }
    // return get all old hands
    const hands = [];
    for (let i = rsp.lastHandNetted + 1; i <= handId; i += 1) {
      hands.push(this.db.getHand(tableAddr, i));
    }
    return Promise.all(hands);
  }).then((hands) => {
    if (hands.length === 0) {
      return Promise.resolve('netting not needed');
    }
    // prevent overwriting netting
    if (hands[hands.length - 1].netting) {
      return Promise.resolve('netting already found');
    }
    // sum up previous hands
    for (let i = 0; i < hands.length; i += 1) {
      for (let pos = 0; pos < hands[i].lineup.length; pos += 1) {
        if (hands[i].lineup[pos].last) {
          balances[hands[i].lineup[pos].address] -= EWT.parse(hands[i].lineup[pos].last).values[1];
        }
      }
      const dists = EWT.parse(hands[i].distribution).values[2];
      for (let j = 0; j < dists.length; j += 1) {
        const dist = EWT.separate(dists[j]);
        balances[dist.address] += dist.amount;
      }
    }
    // build receipt
    const balLength = Object.keys(balances).length;
    const recLength = 28;
    const balBuf = Buffer.alloc((balLength * recLength) + 20);
    balBuf.write(tableAddr.replace('0x', ''), 0, 20, 'hex');
    balBuf.writeUInt32BE(handId, 0);
    Object.keys(balances).forEach((key, i) => {
      ethUtil.setLength(balances[key], 8).copy(balBuf, (i * recLength) + 20);
      balBuf.write(key.replace('0x', ''), (i * recLength) + 28, 20, 'hex');
    });
    // write netting
    return this.db.updateNetting(tableAddr, handId, {
      newBalances: `0x${balBuf.toString('hex')}`,
      [this.oracleAddr]: `0x${sign(balBuf, this.oraclePriv)}`,
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
  const balances = { [this.oracleAddr]: 0 };
  for (let pos = 0; pos < lineup.length; pos += 1) {
    balances[lineup[pos].address] = lineup[pos].amount;
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
      for (let pos = 0; pos < hands[i].lineup.length; pos += 1) {
        if (hands[i].lineup[pos].last) {
          balances[hands[i].lineup[pos].address] -= EWT.parse(hands[i].lineup[pos].last).values[1];
        }
      }
      const dists = EWT.parse(hands[i].distribution).values[2];
      for (let j = 0; j < dists.length; j += 1) {
        const dist = EWT.separate(dists[j]);
        balances[dist.address] += dist.amount;
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
  const dists = [];
  Object.keys(winners).forEach((winnerAddr) => {
    dists.push(EWT.concat(winnerAddr, winners[winnerAddr]).toString('hex'));
  });
  let claimId = 0;
  if (hand.distribution) {
    claimId = this.rc.get(hand.distribution).values[1] + 1;
  }
  const dist = new EWT(ABI_DIST).distribution(hand.handId, claimId, dists).sign(this.oraclePriv);
  return this.db.updateDistribution(tableAddr, hand.handId, dist).then(() => {
    this.log(`HandComplete: ${tableAddr}`, {
      level: 'info',
      tags: {
        tableAddr,
        handId: hand.handId,
      },
      extra: { dist, hand },
    });
    return Promise.resolve(dist);
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
      if (prevHand.lineup[pos].last) {
        balances[prevHand.lineup[pos].address] -= EWT.parse(prevHand.lineup[pos].last).values[1];
      }
    }
    const dists = EWT.parse(prevHand.distribution).values[2];
    for (let j = 0; j < dists.length; j += 1) {
      const dist = EWT.separate(dists[j]);
      balances[dist.address] += dist.amount;
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
