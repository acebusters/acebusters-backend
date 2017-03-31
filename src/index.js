import ethUtil from 'ethereumjs-util';
import EWT from 'ethereum-web-token';
import bufferShim from 'buffer-shims';
import crypto from 'crypto';
import Solver from 'pokersolver';
import { PokerHelper, Receipt } from 'poker-helper';


const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['c', 'd', 'h', 's'];
const RAKE = 0.01;

const ABI_DIST = [{ name: 'distribution', type: 'function', inputs: [{ type: 'uint' }, { type: 'uint' }, { type: 'bytes32[]' }] }];

const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';

const sign = function (payload, privStr) {
  const priv = new Buffer(privStr.replace('0x', ''), 'hex');
  const hash = ethUtil.sha3(payload);
  const sig = ethUtil.ecsign(hash, priv);
  return sig.r.toString('hex') + sig.s.toString('hex') + sig.v.toString(16);
};

const contains = function (needle) {
    // Per spec, the way to identify NaN is that it is not equal to itself
  const findNaN = needle !== needle;
  let indexOf;

  if (!findNaN && typeof Array.prototype.indexOf === 'function') {
    indexOf = Array.prototype.indexOf;
  } else {
    indexOf = function (needle) {
      let i = -1;
      let index = -1;

      for (i = 0; i < this.length; i += 1) {
        const item = this[i];

        if ((findNaN && item !== item) || item === needle) {
          index = i;
          break;
        }
      }

      return index;
    };
  }

  return indexOf.call(this, needle) > -1;
};

const err = function (sentry) {
  const errFunc = function (e) {
    sentry.captureException(e, (sendErr) => {
      if (sendErr) {
        console.error(`Failed to send captured exception to Sentry: ${sendErr}`);
      }
    });
    return e;
  };
  return errFunc;
};

const shuffle = function () {
  const array = [];
  for (let i = 0; i < 52; i += 1) {
    array.push(i);
  }
  for (let i = array.length - 1; i > 0; i--) {
    const j = crypto.randomBytes(1)[0] % i;
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
  return array;
};

const EventWorker = function (table, factory, db, oraclePriv, sentry) {
  this.table = table;
  this.factory = factory;
  this.db = db;
  if (oraclePriv) {
    this.oraclePriv = oraclePriv;
    const priv = new Buffer(oraclePriv.replace('0x', ''), 'hex');
    this.oracleAddr = `0x${ethUtil.privateToAddress(priv).toString('hex')}`;
  }
  this.helper = new PokerHelper();
  this.sentry = sentry;
};

EventWorker.prototype.process = function (msg) {
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
    tasks.push(this.submitLeave(msgBody.tableAddr, msgBody.leaveReceipt).catch(err(this.sentry)));
  }

  // have the table propress in netting request, for that
  // we send a leave receipt from the oracle
  if (msgType === 'ProgressNettingRequest') {
    tasks.push(this.progressNettingRequest(msg.Subject.split('::')[1], msgBody.handId).catch(err(this.sentry)));
  }

  // have the table propress in netting
  // call the net function for that
  if (msgType === 'ProgressNetting') {
    tasks.push(this.progressNetting(msg.Subject.split('::')[1]).catch(err(this.sentry)));
  }

  // this is where we take all receipt and distributions
  // and send them to the contract to net
  if (msgType === 'HandleDispute') {
    tasks.push(this.handleDispute(msgBody.tableAddr, msgBody.lastHandNetted, msgBody.lastNettingRequest).catch(err(this.sentry)));
  }

  // handle HandComplete event:
  if (msgType === 'HandComplete') {
    tasks.push(this.putNextHand(msg.Subject.split('::')[1]).catch(err(this.sentry)));
  }

  // handle TableNettingRequest:
  // we start preparing the netting in db.
  // create netting, sign by oracle, wait for others
  if (msgType === 'TableNettingRequest') {
    tasks.push(this.createNetting(msgBody.tableAddr, msgBody.handId).catch(err(this.sentry)));
  }

  // handle TableNettingComplete, when everyone has signed
  // in db, forward netting to settle() function in table.
  if (msgType === 'TableNettingComplete') {
    let sigs = '0x';
    for (const addr in msgBody.netting) {
      if (msgBody.netting.hasOwnProperty(addr) &&
        addr !== 'newBalances') {
        sigs += msgBody.netting[addr].replace('0x', '');
      }
    }
    tasks.push(this.table.settle(msgBody.tableAddr, msgBody.netting.newBalances, sigs).catch(err(this.sentry)));
  }

  // react to email confirmed. deploy proxy and controller
  // on the chain.
  if (msgType === 'EmailConfirmed') {
    tasks.push(this.factory.createAccount(msgBody.signerAddr).catch(err(this.sentry)));
    tasks.push(this.log(`EmailConfirmed: ${msgBody.signerAddr}`, {
      user: {
        id: msgBody.signerAddr,
      },
      level: 'info',
      extra: msgBody,
    }));
  }

  // react to Netting event in table contract:
  // find all players that have lastHand == lastHandNetted
  // pay out those players
  if (msgType === 'ContractEvent' && msgBody.event === 'Netted') {
    tasks.push(this.payoutPlayers(msgBody.address).catch(err(this.sentry)));
  }

  // react to Join event in table contract:
  // find new player and add to lineup in dynamo
  if (msgType === 'ContractEvent' && msgBody.event === 'Join') {
    tasks.push(this.addPlayer(msgBody.address).catch(err(this.sentry)));
  }

  // react to Leave event in table contract:
  // find player and from lineup in dynamo
  if (msgType === 'ContractEvent' && msgBody.event === 'Leave') {
    tasks.push(this.removePlayer(msgBody.address).catch(err(this.sentry)));
  }

  // nothing to do
  return tasks;
};

EventWorker.prototype.log = function (message, context) {
  return new Promise((fulfill, reject) => {
    this.sentry.captureMessage(message, context, (error, eventId) => {
      if (error) {
        reject(error);
        return;
      }
      fulfill(eventId);
    });
  });
};

EventWorker.prototype.submitLeave = function (tableAddr, leaveReceipt) {
  let leaveHex;
  let leave;
  let txHash;
  try {
    leaveHex = Receipt.parseToHex(leaveReceipt);
    leave = Receipt.parse(leaveReceipt);
  } catch (error) {
    return Promise.reject(error);
  }
  return this.table.leave(tableAddr, leaveHex).then((_txHash) => {
    txHash = _txHash;
    return this.table.getLineup(tableAddr);
  }).then((rsp) => {
    if (rsp.lastHandNetted >= leave.handId) {
      return this.table.payout(tableAddr, leave.signerAddr);
    }
    return Promise.resolve('');
  }).then(payoutHash => Promise.resolve([txHash, payoutHash]));
};

EventWorker.prototype.progressNettingRequest = function (tableAddr, handId) {
  const leaveHex = Receipt.leave(tableAddr, handId, this.oracleAddr).signToHex(this.oraclePriv);
  return this.table.leave(tableAddr, leaveHex);
};

EventWorker.prototype.kickPlayer = function (tableAddr, pos) {
  // 1. get last hand
  // 2. check player really overstayed sitout
  // 3. get lineup
  // 4. check player still in lineup
  // 5. make receipt
  // 6. store in lineup
  // 7. send to contract
};

EventWorker.prototype.progressNettingRequest = function (tableAddr, handId) {
  const leaveHex = Receipt.leave(tableAddr, handId, this.oracleAddr).signToHex(this.oraclePriv);
  return this.table.leave(tableAddr, leaveHex);
};

EventWorker.prototype.progressNetting = function (tableAddr) {
  return this.table.net(tableAddr);
};

EventWorker.prototype.handleDispute = function (tableAddr, lastHandNetted, lastNettingRequest) {
  const receipts = [];
  const dists = [];
  const handProms = [];
  let txHash1;
  let betsHex = '0x';
  let betSigs = '0x';
  for (let i = lastHandNetted + 1; i <= lastNettingRequest; i += 1) {
    handProms.push(this.db.getHand(tableAddr, i));
  }
  return Promise.all(handProms).then((hands) => {
    let i;
    let pos;
    let distsHex = '0x';
    let distSigs = '0x';
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
    return this.table.submitBets(tableAddr, betsHex, betSigs);
  }).then(txHash => [txHash1, txHash]);
};

EventWorker.prototype.payoutPlayers = function (tableAddr) {
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

EventWorker.prototype.createNetting = function (tableAddr, handId) {
  const balances = { [this.oracleAddr]: 0 };
  return this.table.getLineup(tableAddr).then((rsp) => {
    for (let pos = 0; pos < rsp.lineup.length; pos += 1) {
      if (rsp.lineup[pos].address && rsp.lineup[pos].address !== EMPTY_ADDR) {
        balances[rsp.lineup[pos].address] = rsp.lineup[pos].amount;
      }
    }
    // return get all old hands
    const hands = [];
    for (let i = rsp.lastHandNetted + 1; i <= handId; i += 1) { hands.push(this.db.getHand(tableAddr, i)); }
    return Promise.all(hands);
  }).then((hands) => {
    // sum up previous hands
    for (let i = 0; i < hands.length; i += 1) {
      for (let pos = 0; pos < hands[i].lineup.length; pos += 1) {
        if (hands[i].lineup[pos].last) { balances[hands[i].lineup[pos].address] -= EWT.parse(hands[i].lineup[pos].last).values[1]; }
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
    const balBuf = bufferShim.alloc((balLength * recLength) + 20);
    balBuf.write(tableAddr.replace('0x', ''), 0, 20, 'hex');
    balBuf.writeUInt32BE(handId, 0);
    let i = 0;
    for (const key in balances) {
      if (balances.hasOwnProperty(key)) {
        ethUtil.setLength(balances[key], 8).copy(balBuf, (i * recLength) + 20);
        balBuf.write(key.replace('0x', ''), (i * recLength) + 28, 20, 'hex');
        i += 1;
      }
    }
    // write netting
    return this.db.updateNetting(tableAddr, handId, {
      newBalances: `0x${balBuf.toString('hex')}`,
      [this.oracleAddr]: `0x${sign(balBuf, this.oraclePriv)}`,
    });
  });
};

EventWorker.prototype.addPlayer = function (tableAddr) {
  let hand;
  const lup = this.table.getLineup(tableAddr);
  const ddp = this.db.getLastHand(tableAddr);
  return Promise.all([lup, ddp]).then((responses) => {
    hand = responses[1];
    const params = responses[0];
    if (params.lastHandNetted > hand.handId) { return Promise.reject(`contract handId ${params.lastHandNetted} ahead of table handId ${hand.handId}`); }
    if (!hand.lineup || hand.lineup.length !== params.lineup.length) { return Promise.reject(`table lineup length ${hand.lineup.length} does not match contract.`); }
    let joinPos = -1;
    let emptyCount = 0;
    for (let i = 0; i < hand.lineup.length; i += 1) {
      // if seat empty in table
      if (!hand.lineup[i].address ||
        hand.lineup[i].address === EMPTY_ADDR) {
        emptyCount += 1;
        // but filled in contract
        if (params.lineup[i].address &&
          params.lineup[i].address !== EMPTY_ADDR) {
          // remember that seat to work on it
          joinPos = i;
        }
      }
    }
    if (joinPos === -1) { return Promise.reject('no new player found in lineup after join event.'); }
    // now
    const changed = Math.floor(Date.now() / 1000);
    // handle that seat that we eyed before.
    hand.lineup[joinPos].address = params.lineup[joinPos].address;
    if (hand.state !== 'waiting' && hand.state !== 'dealing') {
      hand.lineup[joinPos].sitout = changed;
    }
    // if joining player first player, make him dealer
    if (emptyCount >= (hand.lineup.length - 1)) {
      hand.dealer = joinPos;
    }
    // update db
    return this.db.updateSeat(tableAddr, hand.handId, hand.lineup[joinPos], joinPos, changed, hand.dealer);
  });
};

EventWorker.prototype.removePlayer = function (tableAddr) {
  let hand;
  const lup = this.table.getLineup(tableAddr);
  const ddp = this.db.getLastHand(tableAddr);
  return Promise.all([lup, ddp]).then((responses) => {
    hand = responses[1];
    const params = responses[0];
    if (params.lastHandNetted > hand.handId) {
      return Promise.reject(`contract handId ${params.lastHandNetted} ahead of table handId ${hand.handId}`);
    }
    if (!hand.lineup || hand.lineup.length !== params.lineup.length) {
      return Promise.reject(`table lineup length ${hand.lineup.length} does not match contract.`);
    }
    let leavePos = -1;
    for (let i = 0; i < hand.lineup.length; i += 1) {
      // if seat is taken in table
      if (hand.lineup[i].address &&
        hand.lineup[i].address !== EMPTY_ADDR) {
        // but empty in contract
        if (!params.lineup[i].address ||
          params.lineup[i].address === EMPTY_ADDR) {
          // remember that seat to work on it
          leavePos = i;
          break;
        }
      }
    }
    if (leavePos === -1) { return Promise.reject('no left player found in lineup after Leave event.'); }
    // handle that seat that we eyed before.
    hand.lineup[leavePos] = { address: params.lineup[leavePos].address };
    // update db
    const changed = Math.floor(Date.now() / 1000);
    return this.db.updateSeat(tableAddr, hand.handId, hand.lineup[leavePos], leavePos, changed, hand.dealer);
  });
};

EventWorker.prototype.getBalances = function (tableAddr, lineup, lhn, handId) {
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
        if (hands[i].lineup[pos].last) { balances[hands[i].lineup[pos].address] -= EWT.parse(hands[i].lineup[pos].last).values[1]; }
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

EventWorker.prototype.calcDistribution = function (tableAddr, hand) {
  if (!hand || !hand.deck || !hand.lineup) {
    return Promise.reject(`hand ${hand} at table ${tableAddr} invalid.`);
  }
  let i;
  let j;
  const pots = [];
  const players = [];
  let active;
  let last;
  // create pots
  for (i = 0; i < hand.lineup.length; i += 1) {
    last = (hand.lineup[i].last) ? EWT.parse(hand.lineup[i].last) : null;
    if (last) {
      active = false;
      if (hand.state === 'showdown') {
        if (last.abi[0].name === 'show' || last.abi[0].name === 'muck') {
          if (!contains.call(pots, last.values[1])) {
            pots.push(last.values[1]);
          }
          active = true;
        }
      } else if (this.helper.isActivePlayer(hand.lineup, i)
          || hand.lineup[i].sitout === 'allin') {
        if (!contains.call(pots, last.values[1])) {
          pots.push(last.values[1]);
        }
        active = true;
      }
      players.push({
        pos: i,
        active,
        amount: last.values[1],
      });
    }
  }
  // console.log(JSON.stringify(pots));

  // sort the pots
  pots.sort((a, b) => a - b);
  const evals = [];
  for (i = 0; i < pots.length; i += 1) {
    evals.push({ limit: pots[i], size: 0, chal: [], winners: [] });
  }

  // distribute players on evals
  for (i = 0; i < evals.length; i += 1) {
    for (j = 0; j < players.length; j += 1) {
      if (players[j].amount > 0) {
        const contribution = (evals[i].limit > players[j].amount) ? players[j].amount : evals[i].limit;
        evals[i].size += contribution;
        players[j].amount -= contribution;
        if (players[j].active) {
          evals[i].chal.push(players[j].pos);
        }
      }
    }
  }
  // console.log(JSON.stringify(evals));

  // solve hands
  const deck = [];
  for (i = 0; i < hand.deck.length; i += 1) {
    deck[i] = VALUES[hand.deck[i] % 13] + SUITS[Math.floor(hand.deck[i] / 13)];
  }
  for (i = 0; i < evals.length; i += 1) {
    const hands = [];
    for (j = 0; j < evals[i].chal.length; j += 1) {
      const h = [];
      // hole cards
      h.push(deck[evals[i].chal[j] * 2]);
      h.push(deck[(evals[i].chal[j] * 2) + 1]);
      // board cards
      h.push(deck[20]);
      h.push(deck[21]);
      h.push(deck[22]);
      h.push(deck[23]);
      h.push(deck[24]);
      hands.push(Solver.Hand.solve(h));
    }
    const wnrs = Solver.Hand.winners(hands);
    for (j = 0; j < wnrs.length; j += 1) {
      const pos = evals[i].chal[hands.indexOf(wnrs[j])];
      evals[i].winners.push(pos);
    }
  }
  // console.log(JSON.stringify(evals));

  // sum up pots by players and calc rake
  const winners = {};
  for (i = 0; i < evals.length; i += 1) {
    let total = evals[i].size;
    for (j = 0; j < evals[i].winners.length; j += 1) {
      const addr = hand.lineup[evals[i].winners[j]].address;
      if (!winners[addr]) {
        winners[addr] = 0;
      }
      const share = (evals[i].size - Math.round(evals[i].size * RAKE)) / evals[i].winners.length;
      total -= share;
      winners[addr] += share;
    }
    if (!winners[this.oracleAddr]) {
      winners[this.oracleAddr] = 0;
    }
    winners[this.oracleAddr] += total;
  }
  // console.dir(winners);

  // distribute pots
  const dists = [];
  for (const winnerAddr in winners) {
    if (winners.hasOwnProperty(winnerAddr)) {
      dists.push(EWT.concat(winnerAddr, winners[winnerAddr]).toString('hex'));
    }
  }
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

EventWorker.prototype.putNextHand = function (tableAddr) {
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
      if (prevHand.lineup[pos].last) { balances[prevHand.lineup[pos].address] -= EWT.parse(prevHand.lineup[pos].last).values[1]; }
    }
    const dists = EWT.parse(prevHand.distribution).values[2];
    for (let j = 0; j < dists.length; j += 1) {
      const dist = EWT.separate(dists[j]);
      balances[dist.address] += dist.amount;
    }
    // create new lineup
    for (let i = 0; i < lineup.length; i += 1) {
      delete lineup[i].amount;
      delete lineup[i].exitHand;
      if (prevHand.lineup[i] &&
        prevHand.lineup[i].address === lineup[i].address) {
        // ignore empty seats
        if (lineup[i].address === EMPTY_ADDR) {
          continue;
        }
        // copy over all sitouts
        if (prevHand.lineup[i].sitout) {
          lineup[i].sitout = prevHand.lineup[i].sitout;
        }
        if (prevHand.lineup[i].last) {
          const receipt = EWT.parse(prevHand.lineup[i].last);
          if (receipt.abi[0].name === 'sitOut') {
            lineup[i].sitout = prevHand.changed;
          }
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
    const newDealer = this.helper.nextActivePlayer(lineup, prevDealer);
    const deck = shuffle();
    const changed = Math.floor(Date.now() / 1000);
    return this.db.putHand(tableAddr, prevHand.handId + 1, lineup, newDealer, deck, smallBlind, changed);
  }).then(() => this.log(`NewHand: ${tableAddr}`, {
    level: 'info',
    tags: {
      tableAddr,
      handId: prevHand.handId + 1,
    },
    extra: lineup,
  })).catch((error) => {
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
      return this.db.putHand(tableAddr, rsp[1].lastHandNetted + 1, lineup, 0, deck, smallBlind, changed);
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
