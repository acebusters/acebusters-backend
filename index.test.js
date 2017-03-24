var expect = require('chai').expect;
var sinon = require('sinon');
require('chai').use(require('sinon-chai'));
const EWT = require('ethereum-web-token');
var BigNumber = require('bignumber.js');
var ReceiptCache = require('poker-helper').ReceiptCache;

const Oracle = require('./lib/index');
const Db = require('./lib/db');
const TableContract = require('./lib/tableContract');

// BET can replace lower bet
// BET can replace SIT_OUT during dealing state
const ABI_BET = [{name: 'bet', type: 'function', inputs: [{type: 'uint'}, {type: 'uint'}]}];

// FOLD can replace all but SIT_OUT, and SHOW, given same amount
const ABI_FOLD = [{name: 'fold', type: 'function', inputs: [{type: 'uint'}, {type: 'uint'}]}];
// SIT_OUT can replace all receipts, given same amount
const ABI_SIT_OUT = [{name: 'sitOut', type: 'function', inputs: [{type: 'uint'}, {type: 'uint'}]}];

// CHECK can replace BET with same amount in pre-flop
const ABI_CHECK = [{name: 'check', type: 'function', inputs: [{type: 'uint'}, {type: 'uint'}]}];
// CHECK_FLOP can replace BET or CHECK with same amount in flop
const ABI_CHECK_FLOP = [{name: 'checkFlop', type: 'function', inputs: [{type: 'uint'}, {type: 'uint'}]}];
// CHECK_TURN can replace BET or CHECK_FLOP with same amount in turn
const ABI_CHECK_TURN = [{name: 'checkTurn', type: 'function', inputs: [{type: 'uint'}, {type: 'uint'}]}];
// CHECK_RIVER can replace BET or CHECK_TURN with same amount in river
const ABI_CHECK_RIVER = [{name: 'checkRiver', type: 'function', inputs: [{type: 'uint'}, {type: 'uint'}]}];

// SHOW can replace BET, ALL_IN or CHECK_SHOW with same amount in showdown
const ABI_SHOW = [{name: 'show', type: 'function', inputs: [{type: 'uint'}, {type: 'uint'}]}];

const ABI_LEAVE = [{name: 'leave', type: 'function', inputs: [{type: 'uint'}, {type: 'uint'}]}];

const ABI_DIST = [{name: 'distribution', type: 'function', inputs: [{type: 'uint'},{type: 'uint'},{type: 'bytes32[]'}]}];

const P1_ADDR = '0xf3beac30c498d9e26865f34fcaa57dbb935b0d74';
const P1_KEY = '0x278a5de700e29faae8e40e366ec5012b5ec63d36ec77e8a2417154cc1d25383f';

//secretSeed: 'brother mad churn often amount wing pretty critic rhythm man insane ridge' }
const P2_ADDR = '0xe10f3d125e5f4c753a6456fc37123cf17c6900f2';
const P2_KEY = '0x7bc8feb5e1ce2927480de19d8bc1dc6874678c016ae53a2eec6a6e9df717bfac';

//secretSeed: 'erosion warm student north injury good evoke river despair critic wrestle unveil' }
const P3_ADDR = '0xc3ccb3902a164b83663947aff0284c6624f3fbf2';
const P3_KEY = '0x71d2b12dad610fc929e0596b6e887dfb711eec286b7b8b0bdd742c0421a9c425';

//secretSeed: 'erode melody nature bounce sample deny spend give craft alcohol supply roof' }
const P4_ADDR = '0x82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f';
const P4_KEY = '0x94890218f2b0d04296f30aeafd13655eba4c5bbf1770273276fee52cbe3f2cb4';

const tableAddr = '0x00112233445566778899aabbccddeeff00112233';
const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';

const ORACLE_PRIV = '0x94890218f2b0d04296f30aeafd13655eba4c5bbf1770273276fee52cbe3f2cb4';

const deck = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25]

var dynamo = {
  getItem: function(){},
  putItem: function(){},
  updateItem: function(){},
  query: function(){}
};

var web3 = {
  eth: {
    contract: function(){}
  },
  at: function(){}
}

var contract = {
  getLineup: {
    call: function(){}
  },
  smallBlind: {
    call: function(){}
  }
}

var rc = new ReceiptCache();
sinon.stub(web3.eth, 'contract').returns(web3);
sinon.stub(web3, 'at').returns(contract);

describe('Oracle pay', function() {

  it('should reject receipt with unknown hand Ids.', function(done) {
    var blind = new EWT(ABI_BET).bet(2, 100).sign(P1_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {});
    sinon.stub(dynamo, 'query').yields(null, { Items: [{ handId: 1 }]});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.pay(tableAddr, blind).catch(function(err) {
      expect(err).to.contain('currently playing 1');
      done();
    }).catch(done);
  });

  it('should prevent small blind from player not in lineup.', function(done) {
    var blind = new EWT(ABI_BET).bet(1, 50).sign(P1_KEY);
    var lineup = [0, [P2_ADDR, P3_ADDR], [50000, 50000], [0, 0]];

    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, lineup);
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      state: 'waiting',
      handId: 1,
      dealer: 0,
      lineup: [{
        address: P2_ADDR
      }, {
        address: P3_ADDR
      }]
    }]});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, blind).catch(function(err) {
      expect(err).to.contain('Forbidden');
      done();
    }).catch(done);
  });

  it('should prevent game with less than 2 players.', function(done) {
    var blind = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);

    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, EMPTY_ADDR], [new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      state: 'waiting',
      handId: 1,
      lineup: [{
        address: P1_ADDR
      }, {
        address: EMPTY_ADDR
      }]
    }]});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, blind).catch(function(err) {
      expect(err).to.contain('not enough players');
      done();
    }).catch(done);
  });

  it('should prevent blind with wrong value.', function(done) {
    var blind = new EWT(ABI_BET).bet(1, 80).sign(P1_KEY);

    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR], [new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      state: 'waiting',
      handId: 1,
      dealer: 0,
      lineup: [{
        address: P1_ADDR
      }, {
        address: P2_ADDR
      }]
    }]});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, blind).catch(function(err) {
      expect(err).to.contain('small blind not valid');
      done();
    }).catch(done);
  });

  it('should check position for small blind with 2 players.', function(done) {
    var smallBlind = new EWT(ABI_BET).bet(1, 50).sign(P1_KEY);

    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR], [new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      state: 'waiting',
      handId: 1,
      dealer: 1,
      lineup: [{
        address: P1_ADDR
      }, {
        address: P2_ADDR
      }]
    }]});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, smallBlind).catch(function(err) {
      expect(err).to.contain('not your turn');
      done();
    }).catch(done);
  });

  it('should allow to play small blind with 3+ players.', function(done) {
    var smallBlind = new EWT(ABI_BET).bet(1, 50).sign(P2_KEY);

    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR], [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)], [0, 0, 0]]);
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      state: 'waiting',
      deck: deck,
      handId: 1,
      dealer: 0,
      lineup: [{
        address: P1_ADDR
      }, {
        address: P2_ADDR
      }, {
        address: P3_ADDR
      }]
    }]});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, smallBlind).then(function(rsp) {
      expect(rsp.cards.length).to.eql(2);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', 'dealing')));
      done();
    }).catch(done);
  });

  it('should allow to play big blind with 3+ players.', function(done) {
    const bet2 = new EWT(ABI_BET).bet(1, 50).sign(P2_KEY);
    var lineup = [{ address: P1_ADDR}, {address: P2_ADDR, last: bet2}, {address: P3_ADDR}];

    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR], [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)], [0, 0, 0]]);
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      state: 'dealing',
      deck: deck,
      handId: 1,
      dealer: 0,
      lineup: lineup
    }]});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    const bet3 = new EWT(ABI_BET).bet(1, 100).sign(P3_KEY);

    oracle.pay(tableAddr, bet3).then(function(rsp) {
      expect(rsp.cards.length).to.eql(2);
      done();
    }).catch(done);
  });

  it('should keed state dealing while 0 receipts submitted.', function(done) {
    const bet2 = new EWT(ABI_BET).bet(1, 50).sign(P2_KEY);
    const bet3 = new EWT(ABI_BET).bet(1, 100).sign(P3_KEY);
    var lineup = [{ address: P1_ADDR}, {address: P2_ADDR, last: bet2}, {address: P3_ADDR, last: bet3}, {address: P4_ADDR}];

    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR, P4_ADDR], [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'query').yields(null, []).onFirstCall().yields(null, {Items:[{
      dealer: 0,
      handId: 1,
      state: 'dealing',
      lineup: lineup,
      deck: deck
    }]});

    const bet4 = new EWT(ABI_BET).bet(1, 0).sign(P4_KEY);

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, bet4).then(function(rsp) {
      expect(rsp.cards.length).to.eql(2);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', 'dealing')));
      done();
    }).catch(done);
  });

  it('should set state preflop after last 0 receipts.', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 50).sign(P1_KEY);
    const bet3 = new EWT(ABI_BET).bet(1, 0).sign(P3_KEY);

    var lineup = [{ address: P1_ADDR, last: bet1}, {address: EMPTY_ADDR}, {address: P3_ADDR, last: bet3}, {address: P4_ADDR}];

    sinon.stub(dynamo, 'query').yields(null, []).onFirstCall().yields(null, {Items:[{
      dealer: 3,
      handId: 1,
      state: 'dealing',
      lineup: lineup,
      deck: deck
    }]});
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR, P4_ADDR], [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    const bet4 = new EWT(ABI_BET).bet(1, 0).sign(P4_KEY);

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, bet4).then(function(rsp) {
      expect(rsp.cards.length).to.eql(2);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', 'preflop')));
      done();
    }).catch(done);
  });

  it('should prevent big blind from not in lineup.', function(done) {
    var blind = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);
    var lineup = [{address: '0x1256'}, {address: '0x1234'}];

    sinon.stub(dynamo, 'query').yields(null, []).onFirstCall().yields(null, {Items:[{
      handId: 1,
      lineup: lineup
    }]});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.pay(tableAddr, blind).catch(function(err) {
      expect(err).to.contain('Forbidden');
      done();
    }).catch(done);
  });

  it('should prevent big blind too small.', function(done) {
    var smallBlind = new EWT(ABI_BET).bet(1, 50).sign(P1_KEY);
    var lineup = [{address: P1_ADDR, last: smallBlind}, {address: P2_ADDR}];

    sinon.stub(dynamo, 'query').yields(null, []).onFirstCall().yields(null, {Items:[{
      lineup: lineup,
      handId: 1,
      state: 'dealing',
      dealer: 0
    }]});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    var bigBlind = new EWT(ABI_BET).bet(1, 80).sign(P2_KEY);

    oracle.pay(tableAddr, bigBlind).catch(function(err) {
      expect(err).to.contain('not valid');
      done();
    }).catch(done);
  });

  it('should allow to pay big blind.', function(done) {
    var smallBlind = new EWT(ABI_BET).bet(3, 50).sign(P1_KEY);
    var bigBlind = new EWT(ABI_BET).bet(3, 100).sign(P2_KEY);
    var lineup = [new BigNumber(1), [P1_ADDR, P2_ADDR], [new BigNumber(50000), new BigNumber(50000)], [0, 0]];
    var lastBet = new EWT(ABI_BET).bet(2, 10000).sign(P2_KEY);
    var dist = new EWT(ABI_DIST).distribution(2, 0, [EWT.concat(P2_ADDR, 2000).toString('hex')]).sign(P1_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {Item:{
      handId: 2,
      lineup: [{address: P1_ADDR}, {address: P2_ADDR, last: lastBet}],
      distribution: dist
    }});
    sinon.stub(dynamo, 'query').yields(null, {Items:[{
      handId: 3,
      lineup: [{address: P1_ADDR, last: smallBlind}, {address: P2_ADDR}],
      deck: deck,
      state: 'dealing',
      dealer: 0
    }]});
    sinon.stub(contract.getLineup, 'call').yields(null, lineup);
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, bigBlind).then(function(rsp) {
      expect(rsp).to.eql({
        cards: [2, 3]
      });
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', 'preflop')));
      done();
    }).catch(done);
  });

  it('should prevent betting more than balance.', function(done) {
    const bet = new EWT(ABI_BET).bet(3, 10000).sign(P2_KEY);
    var lineup = [new BigNumber(0), [P1_ADDR, P2_ADDR], [new BigNumber(50000), new BigNumber(25000)], [0, 0]];
    var lastBet = new EWT(ABI_BET).bet(2, 10000).sign(P2_KEY);
    var dist = new EWT(ABI_DIST).distribution(1, 0, [EWT.concat(P1_ADDR, 20000).toString('hex')]).sign(P1_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {Item:{
      lineup: [{address: P1_ADDR}, {address: P2_ADDR, last: lastBet}],
      distribution: dist
    }});
    sinon.stub(dynamo, 'query').yields(null, {Items:[{
      handId: 3,
      lineup: [{address: P1_ADDR}, {address: P2_ADDR}],
      state: 'flop',
      dealer: 0
    }]});
    sinon.stub(contract.getLineup, 'call').yields(null, lineup);

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, bet).catch(function(err) {
      expect(err).to.contain('can not bet more than balance');
      done();
    }).catch(done);
  });

  it('should prevent betting more than balance in same hand.', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    const bet2 = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);

    sinon.stub(dynamo, 'query').yields(null, {Items:[{
      handId: 1,
      lineup: [{address: P1_ADDR, last: bet1}, {address: P2_ADDR, last: bet2}],
      state: 'flop',
      dealer: 0
    }]});
    var lineup = [new BigNumber(1), [P1_ADDR, P2_ADDR], [new BigNumber(500), new BigNumber(150)], [0, 0]];
    sinon.stub(contract.getLineup, 'call').yields(null, lineup);

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    var tooMuchBet = new EWT(ABI_BET).bet(1, 200).sign(P2_KEY);
    oracle.pay(tableAddr, tooMuchBet).catch(function(err) {
      expect(err).to.contain('can not bet more than balance');
      done();
    }).catch(done);
  });

  it('should prevent reusing receipts.', function(done) {
    var blind = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);
    var lineup = [{ address: P1_ADDR}, {address: P2_ADDR, last: blind}];

    sinon.stub(dynamo, 'query').yields(null, []).onFirstCall().yields(null, {Items:[{
      handId: 1,
      lineup: lineup
    }]});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.pay(tableAddr, blind).catch(function(err) {
      expect(err).to.contain('Unauthorized');
      done();
    }).catch(done);
  });

  it('should allow to fold.', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    const bet2 = new EWT(ABI_BET).bet(1, 50).sign(P2_KEY);
    var lineup = [{ address: P1_ADDR, last: bet1}, {address: P2_ADDR, last: bet2},{address: P3_ADDR}];

    sinon.stub(dynamo, 'query').yields(null, {}).onFirstCall().yields(null, {Items:[{
      handId: 1,
      dealer: 0,
      lineup: lineup
    }]});
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR], [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    var fold = new EWT(ABI_FOLD).fold(1, 50).sign(P2_KEY);

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, fold).then(function(rsp) {
      expect(rsp).to.eql({});
      lineup[1].last = fold;
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':l', lineup[1])));
      done();
    }).catch(done);
  });

  it('should allow to go all in.', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    const bet2 = new EWT(ABI_BET).bet(1, 50).sign(P2_KEY);
    var lineup = [{ address: P1_ADDR, last: bet1}, {address: P2_ADDR, last: bet2}];

    sinon.stub(dynamo, 'query').yields(null, {}).onFirstCall().yields(null, {Items:[{
      handId: 1,
      state: 'flop',
      dealer: 0,
      lineup: lineup
    }]});
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR], [new BigNumber(1000), new BigNumber(1000)], [0, 0]]);

    var allin = new EWT(ABI_BET).bet(1, 1000).sign(P2_KEY);
    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, allin).then(function(rsp) {
      expect(rsp).to.eql({});
      const seat = {
        address: P2_ADDR,
        last: allin,
        sitout: 'allin'
      }
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':l', seat)));
      done();
    }).catch(done);
  });

  it('should advance to showdown when last active player calls all-in.', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    const allin = new EWT(ABI_BET).bet(1, 1000).sign(P2_KEY);

    sinon.stub(dynamo, 'query').yields(null, {}).onFirstCall().yields(null, {Items:[{
      handId: 1,
      state: 'flop',
      dealer: 0,
      lineup: [{
        address: P1_ADDR,
        last: bet1
      }, {
        address: P2_ADDR,
        last: allin,
        sitout: 'allin'
      }]
    }]});
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR], [new BigNumber(2000), new BigNumber(1000)], [0, 0]]);

    var call = new EWT(ABI_BET).bet(1, 1000).sign(P1_KEY);
    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, call).then(function(rsp) {
      expect(rsp).to.eql({});
      const seat = {
        address: P1_ADDR,
        last: call
      }
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':l', seat)));
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', 'showdown')));
      done();
    }).catch(done);
  });

  it('should allow to sitout if BB.', function(done) {
    const sb = new EWT(ABI_BET).bet(1, 50).sign(P2_KEY);
    var lineup = [{ address: P1_ADDR}, {address: P2_ADDR, last: sb},{address: P3_ADDR}];

    sinon.stub(dynamo, 'query').yields(null, {}).onFirstCall().yields(null, {Items:[{
      handId: 1,
      dealer: 0,
      state: 'dealing',
      lineup: lineup
    }]});
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR], [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)], [0, 0]]);

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    const sitout = new EWT(ABI_SIT_OUT).sitOut(1, 0).sign(P3_KEY);

    oracle.pay(tableAddr, sitout).then(function(rsp) {
      expect(rsp).to.eql({});
      const seat = { address: P3_ADDR, last: sitout };
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':l', seat)));
      done();
    }).catch(done);
  });

  it('should switch to flop after fold when remaining pl. are even', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 150).sign(P1_KEY);
    const bet2 = new EWT(ABI_BET).bet(1, 150).sign(P2_KEY);
    const bet3 = new EWT(ABI_BET).bet(1, 100).sign(P3_KEY);
    var fold4 = new EWT(ABI_FOLD).fold(1, 0).sign(P4_KEY);
    var lineup = [{ address: P1_ADDR, last: bet1}, {address: P2_ADDR, last: bet2}, {address: P3_ADDR, last: bet3}, {address: P4_ADDR, last: fold4}];

    sinon.stub(dynamo, 'query').yields(null, {}).onFirstCall().yields(null, {Items:[{
      handId: 1,
      dealer: 3,
      state: 'preflop',
      lineup: lineup
    }]});
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR, P4_ADDR], [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var fold3 = new EWT(ABI_FOLD).fold(1, 100).sign(P3_KEY);

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, fold3).then(function(rsp) {
      expect(rsp).to.eql({});
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', 'flop')));
      done();
    }).catch(done);
  });

  it('should prevent bet after fold.', function(done) {
    var fold = new EWT(ABI_FOLD).fold(1, 100).sign(P2_KEY);
    const bet = new EWT(ABI_BET).bet(1, 200).sign(P2_KEY);

    sinon.stub(dynamo, 'query').yields(null, {}).onFirstCall().yields(null, {Items:[{
      handId: 1,
      lineup: [{ address: P1_ADDR}, {address: P2_ADDR, last: fold}]
    }]});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.pay(tableAddr, bet).catch(function(err) {
      expect(err).to.contain('no bet after fold.');
      done();
    }).catch(done);
  });

  it('should prevent bet during sitout.', function(done) {
    var sitout = new EWT(ABI_SIT_OUT).sitOut(1, 100).sign(P2_KEY);
    const bet = new EWT(ABI_BET).bet(1, 200).sign(P2_KEY);

    sinon.stub(dynamo, 'query').yields(null, []).onFirstCall().yields(null, { Items: [{
      handId: 1,
      state: 'flop',
      lineup: [{ address: P1_ADDR}, {address: P2_ADDR, last: sitout}]
    }]});

    new Oracle(new Db(dynamo), null, rc).pay(tableAddr, bet).catch(function(err) {
      expect(err).to.contain('leave sitout only during dealing.');
      done();
    }).catch(done);
  });

  it('should prevent check during wrong state.', function(done) {
    var check = new EWT(ABI_CHECK).check(1, 100).sign(P2_KEY);

    sinon.stub(dynamo, 'query').yields(null, []).onFirstCall().yields(null, { Items: [{
      handId: 1,
      state: 'flop',
      lineup: [{ address: P1_ADDR}, {address: P2_ADDR}]
    }]});

    new Oracle(new Db(dynamo), null, rc).pay(tableAddr, check).catch(function(err) {
      expect(err).to.contain('check only during preflop');
      done();
    }).catch(done);
  });

  it('should prevent check to raise.', function(done) {
    const bet = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);
    var check = new EWT(ABI_CHECK).check(1, 120).sign(P2_KEY);

    sinon.stub(dynamo, 'query').yields(null, []).onFirstCall().yields(null, { Items: [{
      handId: 1,
      state: 'flop',
      lineup: [{ address: P1_ADDR}, {address: P2_ADDR, last: bet}]
    }]});

    new Oracle(new Db(dynamo), null, rc).pay(tableAddr, check).catch(function(err) {
      expect(err).to.contain('check should not raise');
      done();
    }).catch(done);
  });

  it('should allow to deal.', function(done) {
    var smallBlind = new EWT(ABI_BET).bet(1, 50).sign(P2_KEY);
    var bigBlind = new EWT(ABI_BET).bet(1, 100).sign(P3_KEY);
    
    var lineup = [
      {address: P1_ADDR},
      {address: P2_ADDR, last: smallBlind},
      {address: P3_ADDR, last: bigBlind}
    ];
    sinon.stub(dynamo, 'query').yields(null, []).onFirstCall().yields(null, { Items: [{
      handId: 1,
      lineup: lineup,
      state: 'dealing',
      deck: deck,
      dealer: 0
    }]});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    var zeroBlind = new EWT(ABI_BET).bet(1, 0).sign(P1_KEY);

    oracle.pay(tableAddr, zeroBlind).then(function(rsp) {
      expect(rsp.cards.length).to.eql(2);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', 'preflop')));
      done();
    }).catch(done);
  });

  it('should allow to deal with sitout', function(done) {
    var smallBlind = new EWT(ABI_BET).bet(1, 50).sign(P1_KEY);
    var bigBlind = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);
    var sitoutReceipt = new EWT(ABI_SIT_OUT).sitOut(1, 0).sign(P3_KEY);
    var lineup = [
      {address: P1_ADDR, last: smallBlind},
      {address: P2_ADDR},
      {address: P3_ADDR, last: sitoutReceipt}
    ];
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR], [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'query').yields(null, []).onFirstCall().yields(null, { Items: [{
      handId: 1,
      lineup: lineup,
      state: 'dealing',
      deck: deck,
      dealer: 0
    }]});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, bigBlind).then(function(rsp) {
      expect(rsp).to.eql({
        cards: [2, 3]
      });
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', 'preflop')));
      done();
    }).catch(done);
  });

  it('should allow to check', function(done) {
    var check1 = new EWT(ABI_CHECK_FLOP).checkFlop(1, 150).sign(P1_KEY);
    const bet2 = new EWT(ABI_BET).bet(1, 150).sign(P2_KEY);
    const bet3 = new EWT(ABI_BET).bet(1, 150).sign(P3_KEY);
    var lineup = [
      {address: P1_ADDR, last: check1},
      {address: P2_ADDR, last: bet2},
      {address: P3_ADDR, last: bet3}
    ];
    var check2 = new EWT(ABI_CHECK_FLOP).checkFlop(1, 150).sign(P2_KEY);
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR], [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'query').yields(null, []).onFirstCall().yields(null, { Items: [{
      handId: 1,
      lineup: lineup,
      state: 'flop',
      deck: deck,
      dealer: 0
    }]});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, check2).then(function(rsp) {
      expect(rsp).to.eql({
        cards: [2, 3]
      });
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', 'flop')));
      done();
    }).catch(done);
  });

  it('should allow to check multiple rounds', function(done) {
    var check1 = new EWT(ABI_CHECK_FLOP).checkFlop(1, 150).sign(P1_KEY);
    var check2 = new EWT(ABI_CHECK_TURN).checkTurn(1, 150).sign(P2_KEY);
    var check3 = new EWT(ABI_CHECK_FLOP).checkFlop(1, 150).sign(P3_KEY);
    var lineup = [
      {address: P1_ADDR, last: check1},
      {address: P2_ADDR, last: check2},
      {address: P3_ADDR, last: check3}
    ];
    var check3a = new EWT(ABI_CHECK_TURN).checkTurn(1, 150).sign(P3_KEY);
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR], [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'query').yields(null, []).onFirstCall().yields(null, { Items: [{
      handId: 1,
      lineup: lineup,
      state: 'turn',
      deck: deck,
      dealer: 0
    }]});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, check3a).then(function(rsp) {
      expect(rsp).to.eql({
        cards: [4, 5]
      });
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', 'turn')));
      done();
    }).catch(done);
  });

  it('should allow to flop with sitout', function(done) {
    var smallBlind = new EWT(ABI_BET).bet(1, 150).sign(P1_KEY);
    var bigBlind = new EWT(ABI_BET).bet(1, 200).sign(P2_KEY);
    var sitoutReceipt = new EWT(ABI_SIT_OUT).sitOut(1, 0).sign(P3_KEY);
    var lineup = [
      {address: P1_ADDR, last: smallBlind},
      {address: P2_ADDR, last: bigBlind},
      {address: P3_ADDR, last: sitoutReceipt}
    ];
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR], [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'query').yields(null, []).onFirstCall().yields(null, { Items: [{
      handId: 1,
      lineup: lineup,
      state: 'preflop',
      deck: deck,
      dealer: 0
    }]});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, new EWT(ABI_BET).bet(1, 200).sign(P1_KEY)).then(function(rsp) {
      expect(rsp).to.eql({
        cards: [0, 1]
      });
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', 'flop')));
      done();
    }).catch(done);
  });

  it('should prevent playing lower bet.', function(done) {
    var smallBlind = new EWT(ABI_BET).bet(1, 50).sign(P1_KEY);
    var bigBlind = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);
    var lowBet = new EWT(ABI_BET).bet(1, 0).sign(P1_KEY);
    var lineup = [
      {address: P1_ADDR, last: smallBlind},
      {address: P2_ADDR, last: bigBlind}
    ];

    sinon.stub(dynamo, 'query').yields(null, []).onFirstCall().yields(null, { Items: [{
      handId: 1,
      lineup: lineup,
      state: 'turn',
      deck: deck,
      dealer: 0
    }]});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.pay(tableAddr, lowBet).catch(function(err) {
      expect(err).to.contain('Unauthorized');
      expect(err).to.contain('match or raise');
      done();
    }).catch(done);
  });

  it('should keep hand state if game ends.', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 50).sign(P1_KEY);
    const bet2 = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);

    var lineup = [
      {address: P1_ADDR, last: bet1},
      {address: P2_ADDR, last: bet2}
    ];

    sinon.stub(dynamo, 'query').yields(null, []).onFirstCall().yields(null, { Items: [{
      lineup: lineup,
      handId: 1,
      state: 'turn',
      deck: deck,
      dealer: 0
    }]});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), null, rc, ORACLE_PRIV);

    var fold = new EWT(ABI_FOLD).fold(1, 50).sign(P1_KEY);

    oracle.pay(tableAddr, fold).then(function(rsp) {
      const seat = {address: P1_ADDR, last: fold};
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':l', seat)));
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', 'turn')));
      done();
    }).catch(done);
  });

  afterEach(function () {
    if (contract.getLineup.call.restore) contract.getLineup.call.restore();
    if (contract.smallBlind.call.restore) contract.smallBlind.call.restore();
    if (dynamo.getItem.restore) dynamo.getItem.restore();
    if (dynamo.putItem.restore) dynamo.putItem.restore();
    if (dynamo.updateItem.restore) dynamo.updateItem.restore();
    if (dynamo.query.restore) dynamo.query.restore();
  });

});

describe('Oracle info', function() {

  it('should allow to get uninitialized info.', function(done) {
    sinon.stub(dynamo, 'query').yields(null, { Items: []});

    new Oracle(new Db(dynamo), null, rc).info(tableAddr, tableAddr).then(function(rsp) {
      expect(rsp).to.eql({
        dealer: 0,
        distribution: '0x1234',
        handId: 0,
        state: 'showdown'
      });
      done();
    }).catch(done);
  });

  it('should not return uninitialized info from unknown tables.', function(done) {
    sinon.stub(dynamo, 'query').yields(null, { Items: []});

    new Oracle(new Db(dynamo), null, rc).info(tableAddr, 'tablex,table').catch(function(err) {
      expect(err).to.contain('Not Found:');
      done();
    }).catch(done);
  });

  it('should allow to get preflop info.', function(done) {
    sinon.stub(dynamo, 'query').yields(null, { Items: [ { 
      handId: 0,
      deck: deck,
      dealer: 0,
      lineup: [],
      changed: 123,
      state: 'preflop'
    }]});

    new Oracle(new Db(dynamo)).info(tableAddr).then(function(rsp) {
      expect(rsp).to.eql({
        handId: 0,
        cards: [],
        dealer: 0,
        lineup: [],
        changed: 123,
        state: 'preflop'
      });
      done();
    }).catch(done);
  });

  it('should allow to get flop info.', function(done) {
    sinon.stub(dynamo, 'query').yields(null, { Items: [ { 
        handId: 0,
        dealer: 0,
        deck: deck,
        lineup: [],
        changed: 123,
        state: 'flop'
    }]});

    new Oracle(new Db(dynamo), null, rc).info(tableAddr).then(function(rsp) {
      expect(rsp).to.eql({
        handId: 0,
        cards: [20, 21, 22],
        dealer: 0,
        lineup: [],
        changed: 123,
        state: 'flop'
      });
      done();
    }).catch(done);
  });

  it('should allow to get turn info.', function(done) {
    sinon.stub(dynamo, 'query').yields(null, { Items: [ { 
        handId: 0,
        dealer: 0,
        deck: deck,
        lineup: [],
        changed: 123,
        state: 'turn'
    }]});

    new Oracle(new Db(dynamo), null, rc).info(tableAddr).then(function(rsp) {
      expect(rsp).to.eql({
        handId: 0,
        cards: [20, 21, 22, 23],
        dealer: 0,
        lineup: [],
        changed: 123,
        state: 'turn'
      });
      done();
    }).catch(done);
  });

  it('should allow to get river info.', function(done) {
    sinon.stub(dynamo, 'query').yields(null, { Items: [ { 
        handId: 0,
        dealer: 0,
        deck: deck,
        lineup: [],
        changed: 123,
        state: 'river'
    }]});

    new Oracle(new Db(dynamo), null, rc).info(tableAddr).then(function(rsp) {
      expect(rsp).to.eql({
        handId: 0,
        cards: [20, 21, 22, 23, 24],
        dealer: 0,
        lineup: [],
        changed: 123,
        state: 'river'
      });
      done();
    }).catch(done);
  });

  it('should allow to get showdown info.', function(done) {
    var show1 = new EWT(ABI_SHOW).show(0, 50).sign(P1_KEY);
    var muck2 = new EWT(ABI_FOLD).fold(0, 50).sign(P2_KEY);
    var lineup = [
      {address: P1_ADDR, last: show1},
      {address: P2_ADDR, last: muck2}
    ];

    sinon.stub(dynamo, 'query').yields(null, { Items: [ { 
        handId: 0,
        dealer: 0,
        deck: deck,
        lineup: lineup,
        changed: 123,
        distribution: 'dist',
        state: 'showdown'
    }]});

    new Oracle(new Db(dynamo), null, rc).info(tableAddr).then(function(rsp) {
      expect(rsp).to.eql({
        handId: 0,
        cards: [20, 21, 22, 23, 24],
        dealer: 0,
        lineup: [{
          address: P1_ADDR,
          cards: [0, 1],
          last: show1
        }, {
          address: P2_ADDR,
          last: muck2
        }],
        changed: 123,
        distribution: 'dist',
        state: 'showdown'
      });
      done();
    }).catch(done);
  });

  afterEach(function () {
    if (dynamo.query.restore) dynamo.query.restore();
  });

});

describe('Oracle get Hand', function() {

  it('should allow to get hand.', function(done) {
  
    sinon.stub(dynamo, 'getItem').yields(null, {Item:{
      state: 'river',
      lineup: [],
      distribution: 'dist'
    }});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.hand(tableAddr, "1").then(function(rsp) {
      expect(rsp.distribution).to.eql('dist');
      done();
    }).catch(done);
  });

  afterEach(function () {
    if (dynamo.getItem.restore) dynamo.getItem.restore();
  });

});


describe('Oracle show', function() {

  it('should prevent show before showdown', function(done) {
    var show1 = new EWT(ABI_SHOW).show(1, 100).sign(P1_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      state: 'river',
      deck: deck
    }});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.show(tableAddr, show1, [0, 1]).catch(function(err) {
      expect(err).to.contain('not in showdown');
      done();
    }).catch(done);
  });

  it('should prevent bet in showdown', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    const bet2 = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);
    var lineup = [
      {address: P1_ADDR, last: bet1},
      {address: P2_ADDR, last: bet2},
    ];
    const bet = new EWT(ABI_BET).bet(1, 200).sign(P1_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: lineup,
      state: 'showdown',
      deck: deck
    }});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.show(tableAddr, bet, [0, 1]).catch(function(err) {
      expect(err).to.contain('only "show" and "muck" receipts');
      done();
    }).catch(done);
  });

  it('should allow to showdown with 1 winner.', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    const bet2 = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);
    var lineup = [
      {address: P1_ADDR, last: bet1},
      {address: P2_ADDR, last: bet2},
    ];

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: lineup,
      state: 'showdown',
      deck: [12,11,2,3,4,5,6,7,8,9,10,1,0,13,14,15,22,17,18,19,20,21,36,23,24,25]
    }});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), null, rc, ORACLE_PRIV);

    var show = new EWT(ABI_SHOW).show(1, 100).sign(P1_KEY);

    oracle.show(tableAddr, show, [12, 11]).then(function(rsp) {
      var trueIsh = sinon.match(function (value) {
        var p = value.ExpressionAttributeValues[':l'];
        return (p.cards[0] == 12 && p.cards[1] == 11 && p.last == show);
      }, "trueIsh");
      expect(dynamo.updateItem).calledWith(sinon.match(trueIsh));
      done();
    }).catch(done);
  });

  it('should allow to show for all-in player.', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    const bet2 = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: [{
        address: P1_ADDR,
        last: bet1,
        sitout: 'allin'
      }, {
        address: P2_ADDR, 
        last: bet2
      }],
      state: 'showdown',
      deck: [12,11,2,3,4,5,6,7,8,9,10,1,0,13,14,15,22,17,18,19,20,21,36,23,24,25]
    }});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), null, rc, ORACLE_PRIV);

    var show = new EWT(ABI_SHOW).show(1, 100).sign(P1_KEY);

    oracle.show(tableAddr, show, [12, 11]).then(function(rsp) {
      var trueIsh = sinon.match(function (value) {
        var p = value.ExpressionAttributeValues[':l'];
        return (p.cards[0] == 12 && p.cards[1] == 11 && p.last == show && !p.sitout);
      }, "trueIsh");
      expect(dynamo.updateItem).calledWith(sinon.match(trueIsh));
      done();
    }).catch(done);
  });

  it('should prevent show by timedout player.', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    const bet2 = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);
    const bet3 = new EWT(ABI_BET).bet(1, 50).sign(P3_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: [{
        address: P1_ADDR,
        last: bet1
      }, {
        address: P2_ADDR,
        last: bet2
      }, {
        address: P3_ADDR,
        last: bet3,
        sitout: 'timeout'
      }],
      state: 'showdown',
      deck: deck
    }});

    var show = new EWT(ABI_SHOW).show(1, 100).sign(P3_KEY);
    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.show(tableAddr, show, [4, 5]).catch(function(err) {
      expect(err).to.contain('not allowed in showdown');
      done();
    }).catch(done);
  });

  it('should prevent show with smaller amount.', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    const bet2 = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: [{
        address: P1_ADDR,
        last: bet1
      }, {
        address: P2_ADDR,
        last: bet2
      }],
      state: 'showdown',
      deck: deck
    }});

    var show = new EWT(ABI_SHOW).show(1, 20).sign(P2_KEY);
    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.show(tableAddr, show, [4, 5]).catch(function(err) {
      expect(err).to.contain('same or highter amount');
      done();
    }).catch(done);
  });

  it('should prevent show by folded player.', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    const bet2 = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);
    const fold = new EWT(ABI_FOLD).fold(1, 50).sign(P3_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: [{
        address: P1_ADDR,
        last: bet1
      }, {
        address: P2_ADDR,
        last: bet2
      }, {
        address: P3_ADDR,
        last: fold,
      }],
      state: 'showdown',
      deck: deck
    }});

    var show = new EWT(ABI_SHOW).show(1, 100).sign(P3_KEY);
    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.show(tableAddr, show, [4, 5]).catch(function(err) {
      expect(err).to.contain('is not an active player');
      done();
    }).catch(done);
  });

  it('should allow to showdown with 2 winners.', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    const bet2 = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);
    var lineup = [
      {address: P1_ADDR, last: bet1},
      {address: P2_ADDR, last: bet2},
    ];

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: lineup,
      state: 'showdown',
      deck: deck
    }});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), null, rc, ORACLE_PRIV);

    var show = new EWT(ABI_SHOW).show(1, 100).sign(P1_KEY);

    oracle.show(tableAddr, show, [0, 1]).then(function(rsp) {
      const seat = {address: P1_ADDR, last: show, cards: [0, 1]};
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':l', seat)));
      done();
    }).catch(done);
  });

  afterEach(function () {
    if (dynamo.getItem.restore) dynamo.getItem.restore();
    if (dynamo.updateItem.restore) dynamo.updateItem.restore();
  });

});

describe('Oracle leave', function() {

  it('should prevent leaving in completed hand.', function(done) {
    var leave = new EWT(ABI_LEAVE).leave(2, 0).sign(P1_KEY);
    var lineup = [{ address: P1_ADDR}, {address: P2_ADDR}];

    sinon.stub(dynamo, 'query').yields(null, { Items: [ { 
      handId: 3,
      state: 'flop',
      lineup: lineup
    }]});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.leave(tableAddr, leave).catch(function(err) {
      expect(err).to.contain('forbidden');
      done();
    }).catch(done);
  });

  it('should allow to leave in next hand.', function(done) {
    var leave = new EWT(ABI_LEAVE).leave(2, 0).sign(P1_KEY);
    var lineup = [{ address: P1_ADDR}, {address: P2_ADDR}];

    sinon.stub(dynamo, 'query').yields(null, { Items: [ { 
      handId: 1,
      state: 'flop',
      lineup: lineup
    }]});
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR], [new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc, ORACLE_PRIV);

    oracle.leave(tableAddr, leave).then(function(rsp) {
      var leaveReceipt = 'AYYP.AAAAAt3u/wARIjPzvqwwxJjZ4mhl80/KpX27k1sNdA==.LzaiEUre4AotA6U2watHmglfWC5siFxSMFdQ+G/+zGwc6HC+Jdn3ScoXPwbfatuzRYfmgODVrqxASHD61Sg+5xw=';
      expect(rsp).to.eql({ leaveReceipt: leaveReceipt });
      const seat = {
        address: P1_ADDR,
        lastHand: 2,
        leaveReceipt: leaveReceipt
      }
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', seat)));
      done();
    }).catch(done);
  });

  it('should allow to leave in previous hand, if this hand hasn\'t started.', function(done) {
    var leave = new EWT(ABI_LEAVE).leave(2, 0).sign(P1_KEY);
    var lineup = [{ address: P1_ADDR}, {address: P2_ADDR}];

    sinon.stub(dynamo, 'query').yields(null, { Items: [ { 
      handId: 3,
      state: 'waiting',
      lineup: lineup
    }]});
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR], [new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc, ORACLE_PRIV);

    oracle.leave(tableAddr, leave).then(function(rsp) {
      var leaveReceipt = 'AYYP.AAAAAt3u/wARIjPzvqwwxJjZ4mhl80/KpX27k1sNdA==.LzaiEUre4AotA6U2watHmglfWC5siFxSMFdQ+G/+zGwc6HC+Jdn3ScoXPwbfatuzRYfmgODVrqxASHD61Sg+5xw=';
      expect(rsp).to.eql({ leaveReceipt: leaveReceipt });
      const seat = {
        address: P1_ADDR,
        lastHand: 2,
        sitout: 1,
        leaveReceipt: leaveReceipt
      }
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', seat)));
      done();
    }).catch(done);
  });

  afterEach(function () {
    if (dynamo.query.restore) dynamo.query.restore();
    if (dynamo.updateItem.restore) dynamo.updateItem.restore();
    if (contract.getLineup.call.restore) contract.getLineup.call.restore();
  });

});

describe('Oracle netting', function() {

  it('should allow to deliver netting.', function(done) {
    var lineup = [{ address: P1_ADDR}, {address: P2_ADDR}, {address: P4_ADDR}];

    const netting = {
        newBalances: '0x000000025b96c8e5858279b31f644501a140e8a7000000000000000082e8c6cf42c8d1ff9594b17a3f50e94a12cc860f000000000000e86cf3beac30c498d9e26865f34fcaa57dbb935b0d740000000000009e34e10f3d125e5f4c753a6456fc37123cf17c6900f2'
    };
    const nettingSig = '0x306f6bc2348440582ca694d4998b082d3b77ad25b62fcf2f22e526a14e50ecf45bdb61d92d77bce6b5c7bce2800ddda525af1622af6b3d6f918993431fff18551c';

    sinon.stub(dynamo, 'getItem').yields(null, {Item:{
      lineup: lineup,
      netting: netting
    }});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), null, rc);


    oracle.netting(tableAddr, 2, nettingSig).then(function() {
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', nettingSig )));
      done();
    }).catch(done);
  });

  afterEach(function () {
    if (dynamo.getItem.restore) dynamo.getItem.restore();
    if (dynamo.updateItem.restore) dynamo.updateItem.restore();
  });

});

describe('Oracle timing', function() {

  it('should not timeout if time not up.', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);

    sinon.stub(dynamo, 'query').yields(null, { Items: [ { 
      handId: 1,
      dealer: 0,
      changed: Math.floor(Date.now() / 1000) - 20,
      lineup: [{
        address: P1_ADDR,
        last: bet1
      }, {
        address: P2_ADDR,
        last: new EWT(ABI_BET).bet(1, 100).sign(P2_KEY)
      }]
    }]});

    const oracle = new Oracle(new Db(dynamo), null, rc);
    oracle.timeout(tableAddr).catch(function(err) {
      expect(err).to.contain('second to act');
      done();
    }).catch(done);
  });

  it('should allow to put player into sitout.', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);

    sinon.stub(dynamo, 'query').yields(null, { Items: [ { 
      handId: 1,
      dealer: 0,
      lineup: [{
        address: P1_ADDR,
        last: bet1
      }, {
        address: P2_ADDR,
        last: new EWT(ABI_BET).bet(1, 100).sign(P2_KEY)
      }]
    }]});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    const oracle = new Oracle(new Db(dynamo), null, rc);
    oracle.timeout(tableAddr).then(function(rsp) {
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':l', {
        address: P1_ADDR,
        last: bet1,
        sitout: sinon.match.number
      } )));
      done();
    }).catch(done);
  });

  it('should handle sitout on hand state complete.', function(done) {
    const bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    var fold = new EWT(ABI_FOLD).fold(1, 50).sign(P2_KEY);

    sinon.stub(dynamo, 'query').yields(null, { Items: [ { 
      handId: 1,
      dealer: 0,
      lineup: [{
        address: P1_ADDR,
        last: bet1
      }, {
        address: P2_ADDR,
        last: fold
      }]
    }]});

    const oracle = new Oracle(new Db(dynamo), null, rc);
    oracle.timeout(tableAddr).catch(function(err) {
      expect(err).to.contain('Bad Request');
      done();
    }).catch(done);
  });

  afterEach(function () {
    if (dynamo.query.restore) dynamo.query.restore();
    if (dynamo.updateItem.restore) dynamo.updateItem.restore();
  });

});
