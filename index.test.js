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

describe('Oracle pay', function() {

  beforeEach(function () {
    sinon.stub(web3.eth, 'contract').returns(web3);
    sinon.stub(web3, 'at').returns(contract);
  });

  it('should prevent new hand if old one not complete.', function(done) {
    var blind = new EWT(ABI_BET).bet(2, 100).sign(P1_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {Item:{handId: 1}}).onFirstCall().yields(null, {});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.pay(tableAddr, blind).catch(function(err) {
      expect(err).to.contain('still playing');
      done();
    }).catch(done);
  });

  it('should prevent small blind from player not in lineup.', function(done) {
    var blind = new EWT(ABI_BET).bet(1, 50).sign(P1_KEY);
    var lineup = [0, [P2_KEY, P3_KEY], [50000, 50000], [0, 0]];

    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, lineup);
    sinon.stub(dynamo, 'getItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, blind).catch(function(err) {
      expect(err).to.contain('Forbidden');
      done();
    }).catch(done);
  });

  it('should prevent game with less than 2 players.', function(done) {
    var blind = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);

    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR], [new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'getItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, blind).catch(function(err) {
      expect(err).to.contain('no-one there to play');
      done();
    }).catch(done);
  });

  it('should prevent blind with wrong value.', function(done) {
    var blind = new EWT(ABI_BET).bet(1, 80).sign(P1_KEY);

    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR], [new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'getItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, blind).catch(function(err) {
      expect(err).to.contain('small blind not valid');
      done();
    }).catch(done);
  });

  it('should check position for small blind with 2 players.', function(done) {
    var smallBlind = new EWT(ABI_BET).bet(1, 50).sign(P2_KEY);

    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR], [new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'getItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, smallBlind).catch(function(err) {
      expect(err).to.contain('not your turn');
      done();
    }).catch(done);
  });

  it('should check position for small blind with 3+ players in dealing.', function(done) {
    var smallBlind = new EWT(ABI_BET).bet(1, 50).sign(P2_KEY);

    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR], [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)], [0, 0, 0]]);
    sinon.stub(dynamo, 'getItem').yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, smallBlind).then(function(rsp) {
      expect(rsp.cards.length).to.eql(2);
      done();
    }).catch(done);
  });

  it('should check position for big blind with 3+ players.', function(done) {
    var bet2 = new EWT(ABI_BET).bet(1, 50).sign(P2_KEY);
    var lineup = [{ address: P1_ADDR}, {address: P2_ADDR, last: bet2}, {address: P3_ADDR}];

    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR], [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)], [0, 0, 0]]);
    sinon.stub(dynamo, 'getItem').yields(null, {Item:{
      lineup: lineup,
      deck: deck,
      handState: 'dealing',
      dealer: 0
    }});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    var bet3 = new EWT(ABI_BET).bet(1, 100).sign(P3_KEY);

    oracle.pay(tableAddr, bet3).then(function(rsp) {
      expect(rsp.cards.length).to.eql(2);
      done();
    }).catch(done);
  });

  it('should wait for all 0 receipts', function(done) {
    var bet2 = new EWT(ABI_BET).bet(1, 50).sign(P2_KEY);
    var bet3 = new EWT(ABI_BET).bet(1, 100).sign(P3_KEY);
    var lineup = [{ address: P1_ADDR}, {address: P2_ADDR, last: bet2}, {address: P3_ADDR, last: bet3}, {address: P4_ADDR}];

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      dealer: 0,
      handState: 'dealing',
      lineup: lineup,
      deck: deck
    }});
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR, P4_ADDR], [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var bet4 = new EWT(ABI_BET).bet(1, 0).sign(P4_KEY);

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, bet4).then(function(rsp) {
      expect(rsp.cards.length).to.eql(2);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', 'dealing')));
      done();
    }).catch(done);
  });

  it('should set state preflop after last 0 receipts', function(done) {
    var bet1 = new EWT(ABI_BET).bet(1, 50).sign(P1_KEY);
    var bet2 = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);
    var bet3 = new EWT(ABI_BET).bet(1, 0).sign(P3_KEY);

    var lineup = [{ address: P1_ADDR, last: bet1}, {address: P2_ADDR, last: bet2}, {address: P3_ADDR, last: bet3}, {address: P4_ADDR}];

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      dealer: 3,
      handState: 'dealing',
      lineup: lineup,
      deck: deck
    }});
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR, P4_ADDR], [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var bet4 = new EWT(ABI_BET).bet(1, 0).sign(P4_KEY);

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, bet4).then(function(rsp) {
      expect(rsp.cards.length).to.eql(2);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', 'preflop')));
      done();
    }).catch(done);
  });

  it('should allow to pay small blind for hand 0.', function(done) {    
    var lineup = [new BigNumber(0), [P1_ADDR, P2_ADDR], [new BigNumber(50000), new BigNumber(50000)], [0, 0]];

    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, lineup);
    sinon.stub(dynamo, 'getItem').yields(null, {});//.onFirstCall().yields(null, {Item:[]});
    sinon.stub(dynamo, 'putItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    var blind = new EWT(ABI_BET).bet(1, 50).sign(P1_KEY);

    oracle.pay(tableAddr, blind).then(function(rsp) {
      expect(dynamo.putItem).calledWith({Item: {
        deck: sinon.match.any,
        handState: 'dealing',
        handId: 1,
        dealer: 0,
        lineup: [{address: P1_ADDR, last: blind},{address: P2_ADDR}],
        tableAddr: tableAddr
      }, TableName: 'poker'});
      done();
    }).catch(done);
  });

  it('should allow to pay small blind for next hand.', function(done) {
    var blind = new EWT(ABI_BET).bet(2, 50).sign(P1_KEY);
    var lineup = [new BigNumber(0), [P1_ADDR, P2_ADDR], [new BigNumber(50000), new BigNumber(50000)], [0, 0]];

    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, lineup);
    sinon.stub(dynamo, 'getItem').yields(null, {Item:{
      lineup: [{address: P1_ADDR},{address: P2_ADDR}],
      distribution: 'dist',
      dealer: 1
    }}).onFirstCall().yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, blind).then(function(rsp) {
      expect(dynamo.putItem).calledWith({Item: {
        deck: sinon.match.any,
        handState: 'dealing',
        handId: 2,
        dealer: 0,
        lineup: [{address: P1_ADDR, last: blind},{address: P2_ADDR}],
        tableAddr: tableAddr
      }, TableName: 'poker'});
      done();
    }).catch(done);
  });


  it('should increase dealer for new hand.', function(done) {
    var lineup = [new BigNumber(0), [P1_ADDR, P2_ADDR], [new BigNumber(50000), new BigNumber(50000)], [0, 0]];

    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, lineup);
    sinon.stub(dynamo, 'getItem').yields(null, {Item:{
      lineup: [{address: P1_ADDR},{address: P2_ADDR}],
      distribution: 'dist',
      dealer: 0
    }}).onFirstCall().yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    var blind = new EWT(ABI_BET).bet(2, 50).sign(P2_KEY);

    oracle.pay(tableAddr, blind).then(function(rsp) {
      expect(dynamo.putItem).calledWith({Item: {
        deck: sinon.match.any,
        handState: 'dealing',
        handId: 2,
        dealer: 1,
        lineup: [{address: P1_ADDR},{address: P2_ADDR, last: blind}],
        tableAddr: tableAddr
      }, TableName: 'poker'});
      done();
    }).catch(done);
  });

  it('should prevent big blind from not in lineup.', function(done) {
    var blind = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);
    var lineup = [{address: '0x1256'}, {address: '0x1234'}];

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: lineup
    }});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.pay(tableAddr, blind).catch(function(err) {
      expect(err).to.contain('Forbidden');
      done();
    }).catch(done);
  });

  it('should prevent big blind too small.', function(done) {
    var smallBlind = new EWT(ABI_BET).bet(1, 50).sign(P1_KEY);
    var lineup = [{address: P1_ADDR, last: smallBlind}, {address: P2_ADDR}];

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: lineup,
      handState: 'dealing',
      dealer: 0
    }});

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
    var lineup = [new BigNumber(0), [P1_ADDR, P2_ADDR], [new BigNumber(50000), new BigNumber(50000)], [0, 0]];
    var lastBet = new EWT(ABI_BET).bet(2, 10000).sign(P2_KEY);
    var dist = new EWT(ABI_DIST).distribution(1, 0, [EWT.concat(P2_ADDR, 2000).toString('hex')]).sign(P1_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {Item:{
      lineup: [{address: P1_ADDR}, {address: P2_ADDR, last: lastBet}],
      distribution: dist
    }}).onFirstCall().yields(null, {Item:{
      lineup: [{address: P1_ADDR, last: smallBlind}, {address: P2_ADDR}],
      deck: deck,
      handState: 'dealing',
      dealer: 0
    }});
    sinon.stub(contract.getLineup, 'call').yields(null, lineup);
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, bigBlind).then(function(rsp) {
      expect(rsp).to.eql({
        cards: [2, 3]
      });
      //expect(dynamo.updateItem).calledWith({});
      done();
    }).catch(done);
  });

  it('should prevent betting more than balance.', function(done) {
    var bet = new EWT(ABI_BET).bet(3, 10000).sign(P2_KEY);
    var lineup = [new BigNumber(0), [P1_ADDR, P2_ADDR], [new BigNumber(50000), new BigNumber(25000)], [0, 0]];
    var lastBet = new EWT(ABI_BET).bet(2, 10000).sign(P2_KEY);
    var dist = new EWT(ABI_DIST).distribution(1, 0, [EWT.concat(P1_ADDR, 20000).toString('hex')]).sign(P1_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {Item:{
      lineup: [{address: P1_ADDR}, {address: P2_ADDR, last: lastBet}],
      distribution: dist
    }}).onFirstCall().yields(null, {Item:{
      lineup: [{address: P1_ADDR}, {address: P2_ADDR}],
      handState: 'flop',
      dealer: 0
    }});
    sinon.stub(contract.getLineup, 'call').yields(null, lineup);

    var oracle = new Oracle(new Db(dynamo), new TableContract(web3), rc);

    oracle.pay(tableAddr, bet).catch(function(err) {
      expect(err).to.contain('can not bet more than balance');
      done();
    }).catch(done);
  });

  it('should prevent betting more than balance in same hand.', function(done) {
    var bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    var bet2 = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {Item:{
      lineup: [{address: P1_ADDR, last: bet1}, {address: P2_ADDR, last: bet2}],
      handState: 'flop',
      dealer: 0
    }});
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

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: lineup
    }});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.pay(tableAddr, blind).catch(function(err) {
      expect(err).to.contain('Unauthorized');
      done();
    }).catch(done);
  });

  it('should allow to fold.', function(done) {
    var bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    var bet2 = new EWT(ABI_BET).bet(1, 50).sign(P2_KEY);
    var lineup = [{ address: P1_ADDR, last: bet1}, {address: P2_ADDR, last: bet2},{address: P3_ADDR}];

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      dealer: 0,
      lineup: lineup
    }});
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

  it('should switch to flop after fold when remaining pl. are even', function(done) {
    var bet1 = new EWT(ABI_BET).bet(1, 150).sign(P1_KEY);
    var bet2 = new EWT(ABI_BET).bet(1, 150).sign(P2_KEY);
    var bet3 = new EWT(ABI_BET).bet(1, 100).sign(P3_KEY);
    var fold4 = new EWT(ABI_FOLD).fold(1, 0).sign(P4_KEY);
    var lineup = [{ address: P1_ADDR, last: bet1}, {address: P2_ADDR, last: bet2}, {address: P3_ADDR, last: bet3}, {address: P4_ADDR, last: fold4}];

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      dealer: 3,
      handState: 'preflop',
      lineup: lineup
    }});
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
    var bet = new EWT(ABI_BET).bet(1, 200).sign(P2_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: [{ address: P1_ADDR}, {address: P2_ADDR, last: fold}]
    }});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.pay(tableAddr, bet).catch(function(err) {
      expect(err).to.contain('no bet after fold.');
      done();
    }).catch(done);
  });

  it('should prevent bet during sitout.', function(done) {
    var sitout = new EWT(ABI_SIT_OUT).sitOut(1, 100).sign(P2_KEY);
    var bet = new EWT(ABI_BET).bet(1, 200).sign(P2_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      handState: 'flop',
      lineup: [{ address: P1_ADDR}, {address: P2_ADDR, last: sitout}]
    }});

    new Oracle(new Db(dynamo), null, rc).pay(tableAddr, bet).catch(function(err) {
      expect(err).to.contain('leave sitout only during dealing.');
      done();
    }).catch(done);
  });

  it('should prevent check during wrong state.', function(done) {
    var check = new EWT(ABI_CHECK).check(1, 100).sign(P2_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      handState: 'flop',
      lineup: [{ address: P1_ADDR}, {address: P2_ADDR}]
    }});

    new Oracle(new Db(dynamo), null, rc).pay(tableAddr, check).catch(function(err) {
      expect(err).to.contain('check only during preflop');
      done();
    }).catch(done);
  });

  it('should prevent check to raise.', function(done) {
    var bet = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);
    var check = new EWT(ABI_CHECK).check(1, 120).sign(P2_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      handState: 'flop',
      lineup: [{ address: P1_ADDR}, {address: P2_ADDR, last: bet}]
    }});

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
    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: lineup,
      handState: 'dealing',
      deck: deck,
      dealer: 0
    }});
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
    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: lineup,
      handState: 'dealing',
      deck: deck,
      dealer: 0
    }});
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
    var bet2 = new EWT(ABI_BET).bet(1, 150).sign(P2_KEY);
    var bet3 = new EWT(ABI_BET).bet(1, 150).sign(P3_KEY);
    var lineup = [
      {address: P1_ADDR, last: check1},
      {address: P2_ADDR, last: bet2},
      {address: P3_ADDR, last: bet3}
    ];
    var check2 = new EWT(ABI_CHECK_FLOP).checkFlop(1, 150).sign(P2_KEY);
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0), [P1_ADDR, P2_ADDR, P3_ADDR], [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)], [0, 0]]);
    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: lineup,
      handState: 'flop',
      deck: deck,
      dealer: 0
    }});
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
    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: lineup,
      handState: 'turn',
      deck: deck,
      dealer: 0
    }});
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
    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: lineup,
      handState: 'preflop',
      deck: deck,
      dealer: 0
    }});
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

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: lineup,
      handState: 'turn',
      deck: deck,
      dealer: 0
    }});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.pay(tableAddr, lowBet).catch(function(err) {
      expect(err).to.contain('Unauthorized');
      expect(err).to.contain('match or raise');
      done();
    }).catch(done);
  });

  it('should allow pre-showdown distribution.', function(done) {
    var bet1 = new EWT(ABI_BET).bet(1, 50).sign(P1_KEY);
    var bet2 = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);

    var lineup = [
      {address: P1_ADDR, last: bet1},
      {address: P2_ADDR, last: bet2}
    ];

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: lineup,
      handState: 'turn',
      deck: deck,
      dealer: 0
    }});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    var fold = new EWT(ABI_FOLD).fold(1, 50).sign(P1_KEY);

    oracle.pay(tableAddr, fold).then(function(rsp) {
      var dist = EWT.parse(rsp.distribution);
      expect(dist.signer).to.eql(P4_ADDR);
      lineup[1].last = fold;
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':l', lineup)));
      done();
    }).catch(done);
  });

  afterEach(function () {
    if (contract.getLineup.call.restore) contract.getLineup.call.restore();
    if (contract.smallBlind.call.restore) contract.smallBlind.call.restore();
    if (web3.eth.contract.restore) web3.eth.contract.restore();
    if (web3.at.restore) web3.at.restore();
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
        handId: 0,
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
      handState: 'preflop'
    }]});

    new Oracle(new Db(dynamo)).info(tableAddr).then(function(rsp) {
      expect(rsp).to.eql({
        handId: 0,
        cards: [],
        dealer: 0,
        lineup: [],
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
        handState: 'flop'
    }]});

    new Oracle(new Db(dynamo), null, rc).info(tableAddr).then(function(rsp) {
      expect(rsp).to.eql({
        handId: 0,
        cards: [20, 21, 22],
        dealer: 0,
        lineup: [],
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
        handState: 'turn'
    }]});

    new Oracle(new Db(dynamo), null, rc).info(tableAddr).then(function(rsp) {
      expect(rsp).to.eql({
        handId: 0,
        cards: [20, 21, 22, 23],
        dealer: 0,
        lineup: [],
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
        handState: 'river'
    }]});

    new Oracle(new Db(dynamo), null, rc).info(tableAddr).then(function(rsp) {
      expect(rsp).to.eql({
        handId: 0,
        cards: [20, 21, 22, 23, 24],
        dealer: 0,
        lineup: [],
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
        distribution: 'dist',
        handState: 'showdown'
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
      handState: 'river',
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
    var show1 = new EWT(ABI_SHOW).show(0, 100).sign(P1_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      handState: 'river',
      deck: deck
    }});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.show(tableAddr, show1, [0, 1]).catch(function(err) {
      expect(err).to.contain('not in showdown');
      done();
    }).catch(done);
  });

  it('should prevent bet in showdown', function(done) {
    var bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    var bet2 = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);
    var lineup = [
      {address: P1_ADDR, last: bet1},
      {address: P2_ADDR, last: bet2},
    ];
    var bet = new EWT(ABI_BET).bet(1, 200).sign(P1_KEY);

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: lineup,
      handState: 'showdown',
      deck: deck
    }});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.show(tableAddr, bet, [0, 1]).catch(function(err) {
      expect(err).to.contain('only "show" and "muck" receipts');
      done();
    }).catch(done);
  });

  it('should allow to showdown with 1 winner.', function(done) {
    var bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    var bet2 = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);
    var lineup = [
      {address: P1_ADDR, last: bet1},
      {address: P2_ADDR, last: bet2},
    ];

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: lineup,
      handState: 'showdown',
      deck: [12,11,2,3,4,5,6,7,8,9,10,1,0,13,14,15,22,17,18,19,20,21,36,23,24,25]
    }});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    var show = new EWT(ABI_SHOW).show(1, 100).sign(P1_KEY);

    oracle.show(tableAddr, show, [12, 11]).then(function(rsp) {
      var dist = EWT.parse(rsp);
      expect(dist.signer).to.eql(P4_ADDR);
      expect(dist.values[2]).to.eql([ 
        '82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f000000000000000000000002',
        'f3beac30c498d9e26865f34fcaa57dbb935b0d740000000000000000000000c6']);
      var trueIsh = sinon.match(function (value) {
        var p = value.ExpressionAttributeValues[':l'][0];
        return (p.cards[0] == 12 && p.cards[1] == 11 && p.last == show);
      }, "trueIsh");
      expect(dynamo.updateItem).calledWith(sinon.match(trueIsh));
      done();
    }).catch(done);
  });

  it('should allow to showdown with 2 winners.', function(done) {
    var bet1 = new EWT(ABI_BET).bet(1, 100).sign(P1_KEY);
    var bet2 = new EWT(ABI_BET).bet(1, 100).sign(P2_KEY);
    var lineup = [
      {address: P1_ADDR, last: bet1},
      {address: P2_ADDR, last: bet2},
    ];

    sinon.stub(dynamo, 'getItem').yields(null, {}).onFirstCall().yields(null, {Item:{
      lineup: lineup,
      handState: 'showdown',
      deck: deck
    }});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    var show = new EWT(ABI_SHOW).show(1, 100).sign(P1_KEY);

    oracle.show(tableAddr, show, [0, 1]).then(function(rsp) {
      var dist = EWT.parse(rsp);
      expect(dist.signer).to.eql(P4_ADDR);
      expect(dist.values[2]).to.eql([
        '82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f000000000000000000000002',
        'f3beac30c498d9e26865f34fcaa57dbb935b0d74000000000000000000000063',
        'e10f3d125e5f4c753a6456fc37123cf17c6900f2000000000000000000000063']);
      //expect(dynamo.updateItem).calledWith({});
      done();
    }).catch(done);
  });

  afterEach(function () {
    if (dynamo.getItem.restore) dynamo.getItem.restore();
    if (dynamo.updateItem.restore) dynamo.updateItem.restore();
  });

});

describe('Oracle leave', function() {

  it('should prevent leaving in active hand.', function(done) {
    var leave = new EWT(ABI_LEAVE).leave(2, 0).sign(P1_KEY);
    var lineup = [{ address: P1_ADDR}, {address: P2_ADDR}];

    sinon.stub(dynamo, 'query').yields(null, { Items: [ { 
      handId: 2,
      lineup: lineup
    }]});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.leave(tableAddr, leave).catch(function(err) {
      expect(err).to.contain('already started');
      done();
    }).catch(done);
  });

  it('should allow to leave.', function(done) {
    var leave = new EWT(ABI_LEAVE).leave(2, 0).sign(P1_KEY);
    var lineup = [{ address: P1_ADDR}, {address: P2_ADDR}];

    sinon.stub(dynamo, 'query').yields(null, { Items: [ { 
      handId: 1,
      lineup: lineup
    }]});
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    var oracle = new Oracle(new Db(dynamo), null, rc);

    oracle.leave(tableAddr, leave).then(function(rsp) {
      var leaveReceipt = '0x00000000000000000000000200112233445566778899aabbccddeeff00112233f3beac30c498d9e26865f34fcaa57dbb935b0d7479762e0f6f962622a8fef43d6ab407d4ca374e4f2c4debd0c6c7d571bfb3b8c615ea51e844d7d322cbde65eb6a123155cae5fee0d210610ab65fee1b50fa75df1c';
      expect(rsp).to.eql({ leaveReceipt: leaveReceipt });
      lineup[0].lastHand = 2;
      lineup[0].leaveReceipt = leaveReceipt;
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':l', lineup[0])));
      done();
    }).catch(done);
  });

  afterEach(function () {
    if (dynamo.query.restore) dynamo.query.restore();
    if (dynamo.updateItem.restore) dynamo.updateItem.restore();
  });

});
