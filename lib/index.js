const attr = require('dynamodb-data-types').AttributeValue;
const PokerHelper = require('poker-helper').PokerHelper;
const ethUtil = require('ethereumjs-util');
const EWT = require('ethereum-web-token');

const leaveReceived = function(oldHand, newHand) {
  for (var i = 0; i < newHand.lineup.length; i++) {
    if (newHand.lineup[i].lastHand !== undefined && 
      oldHand.lineup[i].lastHand === undefined) {
      // return after first leave detected
      // we don't expect more than one per db change
      return i;
    }
  }
  return -1;
}

const handTurnedComplete = function(oldHand, newHand) {
  const ph = new PokerHelper();
  if (ph.checkForNextHand(oldHand) === false && 
    ph.checkForNextHand(newHand) === true) {
    return true;
  }
  return false;
}

const lineupHasLeave = function(newHand) {
  for (var i = 0; i < newHand.lineup.length; i++) {
    if (newHand.lineup[i].lastHand === newHand.handId) {
      return i;
    }
  }
  return -1;
}

const sign = function(payload, privStr) {
  const priv = new Buffer(privStr.replace('0x', ''), 'hex');
  const hash = ethUtil.sha3(payload);
  const sig = ethUtil.ecsign(hash, priv);
  return sig.r.toString('hex') + sig.s.toString('hex') + sig.v.toString(16);
}

var StreamWorker = function(table, db, oraclePriv) {
  this.table = table;
  this.db = db;
  if (oraclePriv) {
    this.oraclePriv = oraclePriv;
    const priv = new Buffer(oraclePriv.replace('0x', ''), 'hex');
    this.oracleAddr = '0x' + ethUtil.privateToAddress(priv).toString('hex');
  }
}

StreamWorker.prototype.process = function(record) {

  if (!record.eventName || record.eventName !== 'MODIFY') {
    return Promise.reject('unknown record type');
  }
  const newHand = attr.unwrap(record.dynamodb.NewImage);
  const oldHand = attr.unwrap(record.dynamodb.OldImage);
  const keys = attr.unwrap(record.dynamodb.Keys);

  // check leave
  var pos = leaveReceived(oldHand, newHand);
  if (pos > -1) {
    return this.table.leave(keys.tableAddr, newHand.lineup[pos].leaveReceipt);
  }

  // check hand complete and leaving player
  const ph = new PokerHelper();
  pos = lineupHasLeave(newHand);
  if (pos > -1 && 
    ph.checkForNextHand(newHand) === true &&
    newHand.distribution !== undefined &&
    newHand.netting === undefined) {
    return this.createNetting(keys.tableAddr, newHand.handId, newHand);
  }

  // check netting complete
  if (newHand.lineup !== undefined &&
    oldHand.netting !== undefined &&
    newHand.netting !== undefined &&
    Object.keys(newHand.netting).length > Object.keys(oldHand.netting).length &&
    Object.keys(newHand.netting).length >= newHand.lineup.length) {
    var sigs = '0x';
    for (var addr in newHand.netting) {
      if (newHand.netting.hasOwnProperty(addr) &&
        addr !== 'newBalances') {
        sigs += newHand.netting[addr].replace('0x', '');
      }
    }
    return this.table.settle(keys.tableAddr, newHand.netting.newBalances, sigs);
  }

  // nothing to do
  return Promise.resolve({});
}

StreamWorker.prototype.createNetting = function(tableAddr, handId, thisHand) {
  var self = this, balances = { [this.oracleAddr]: 0 };
  return self.table.getLineup(tableAddr).then(function(rsp) {
    for (var pos = 0; pos < rsp.lineup.length; pos++) {
      balances[rsp.lineup[pos].address] = rsp.lineup[pos].amount.toNumber();
    }
    // return get all old hands
    var hands = [];
    for (var i = rsp.lastHandNetted.toNumber() + 1; i < handId; i ++ )
      hands.push(self.db.getHand(tableAddr, i));
    return Promise.all(hands);
  }).then(function(hands) {
    // sum up previous hands
    for (var i = 0; i < hands.length; i ++) {
      for (var pos = 0; pos < hands[i].lineup.length; pos++) {
        if (hands[i].lineup[pos].last)
          balances[hands[i].lineup[pos].address] -= EWT.parse(hands[i].lineup[pos].last).values[1];
      }
      var dists = EWT.parse(hands[i].distribution).values[2];
      for (var j = 0; j < dists.length; j ++) {
        var dist = EWT.separate(dists[j]);
        balances[dist.address] += dist.amount;
      }
    }
    // sum up current hand
    for (var pos = 0; pos < thisHand.lineup.length; pos++) {
      if (thisHand.lineup[pos].last) {
        balances[thisHand.lineup[pos].address] -= EWT.parse(thisHand.lineup[pos].last).values[1];
      }
    }
    var dists = EWT.parse(thisHand.distribution).values[2];
    for (var j = 0; j < dists.length; j ++) {
      const dist = EWT.separate(dists[j]);
      balances[dist.address] += dist.amount;
    }
    // build receipt
    const balLength = Object.keys(balances).length;
    const recLength = 28;
    const balBuf = Buffer.alloc(balLength * recLength + 20);
    balBuf.write(tableAddr.replace('0x', ''), 0, 20, 'hex');
    balBuf.writeUInt32BE(handId, 0);
    var i = 0;
    for (var key in balances) {
      if (balances.hasOwnProperty(key)) {
        ethUtil.setLength(balances[key], 8).copy(balBuf, i * recLength + 20);
        balBuf.write(key.replace('0x', ''), i * recLength + 28, 20, 'hex');
        i++;
      }
    }
    // write netting
    return self.db.updateNetting(tableAddr, handId, {
      newBalances: '0x' + balBuf.toString('hex'),
      [self.oracleAddr]: '0x' + sign(balBuf, self.oraclePriv)
    });
  });
}

module.exports = StreamWorker;