import chai, { expect } from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import { Receipt } from 'poker-helper';
import { it, describe, afterEach } from 'mocha';
import BigNumber from 'bignumber.js';

import EventWorker from './src/index';
import Table from './src/tableContract';
import TableFactory from './src/tableFactoryContract';
import Db from './src/db';
import MailerLite from './src/mailerLite';
import Lambda from './src/lambda';
import Logger from './src/logger';

chai.use(sinonChai);

const NTZ_DECIMAL = new BigNumber(10).pow(12);
function babz(ntz) {
  return new BigNumber(ntz).mul(NTZ_DECIMAL);
}

const TABLE_ADDR = '0xa2decf075b96c8e5858279b31f644501a140e8a7';

const P1_ADDR = '0xf3beac30c498d9e26865f34fcaa57dbb935b0d74';
const P1_PRIV = '0x278a5de700e29faae8e40e366ec5012b5ec63d36ec77e8a2417154cc1d25383f';

// secretSeed: 'brother mad churn often amount wing pretty critic rhythm man insane ridge' }
const P2_ADDR = '0xe10f3d125e5f4c753a6456fc37123cf17c6900f2';
const P2_PRIV = '0x7bc8feb5e1ce2927480de19d8bc1dc6874678c016ae53a2eec6a6e9df717bfac';

// secretSeed: 'erosion warm student north injury good evoke river despair critic wrestle unveil' }
const P3_ADDR = '0xc3ccb3902a164b83663947aff0284c6624f3fbf2';
const P3_PRIV = '0x71d2b12dad610fc929e0596b6e887dfb711eec286b7b8b0bdd742c0421a9c425';

const P4_ADDR = '0x82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f';
const P4_PRIV = '0x94890218f2b0d04296f30aeafd13655eba4c5bbf1770273276fee52cbe3f2cb4';

// secretSeed: 'erode melody nature bounce sample deny spend give craft alcohol supply roof' }
const ORACLE_ADDR = '0x82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f';
const ORACLE_PRIV = '0x94890218f2b0d04296f30aeafd13655eba4c5bbf1770273276fee52cbe3f2cb4';

const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';

const deck = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];

const contract = {
  leave: {
    getData() {},
    estimateGas() {},
  },
  settle: {
    getData() {},
    estimateGas() {},
  },
  payoutFrom: {
    getData() {},
    estimateGas() {},
  },
  net: {
    getData() {},
    estimateGas() {},
  },
  submit: {
    getData() {},
    estimateGas() {},
    call() {},
  },
  create: {
    getData() {},
    estimateGas() {},
  },
  changeSigner: {
    getData() {},
    estimateGas() {},
  },
  transfer: {
    getData() {},
    estimateGas() {},
  },
  toggleActive: {
    getData() {},
    estimateGas() {},
  },
  getLineup: {
    call() {},
  },
  getAccount: {
    call() {},
  },
  balanceOf: {
    call() {},
  },
  smallBlind: {
    call() {},
  },
  getTables: {
    call() {},
  },
  lastHandNetted: {
    call() {},
  },
};

const sentry = {
  captureMessage() {
  },
  captureException() {
  },
};

const logger = new Logger(sentry, 'event-worker');

const web3 = { eth: {
  contract() {},
  at() {},
  getTransactionCount() {},
} };

const dynamo = {
  getItem() {},
  batchGetItem() {},
  putItem() {},
  query() {},
  updateItem() {},
  deleteItem() {},
};

const sdb = {
  putAttributes() {},
  select() {},
  getAttributes() {},
};

const pusher = {
  trigger() {},
};

const http = {
  request() {},
};

const lambda = {
  invoke() {},
};

const sqs = {
  sendMessage() {},
};

sinon.stub(web3.eth, 'contract').returns(web3.eth);
sinon.stub(web3.eth, 'at', address => ({ ...contract, address }));

const factory = new TableFactory(EMPTY_ADDR, web3, '0x000');
sinon.stub(contract.getTables, 'call').yields(null, [TABLE_ADDR]);

describe('Stream worker HandComplete event', () => {
  it('should calc balances', async () => {
    const tableAddr = '0xa2decf075b96c8e5858279b31f644501a140e8a7';
    sinon.stub(dynamo, 'batchGetItem').yields(null, { Responses: {
      sb_cashgame: [{
        handId: 2,
        dealer: 0,
        state: 'preflop',
        lineup: [{
          address: P1_ADDR,
        }, {
          address: P2_ADDR,
          last: new Receipt(EMPTY_ADDR).bet(2, babz(30)).sign(P2_PRIV),
        }, {
          address: P3_ADDR,
          last: new Receipt(EMPTY_ADDR).bet(2, babz(50)).sign(P3_PRIV),
        }],
        deck,
      }],
    } });

    const worker = new EventWorker(new Table(web3, '0x1255'), new Db(dynamo), ORACLE_PRIV, logger);
    const balances = await worker.getBalances(
      tableAddr,
      [
        {
          address: P1_ADDR,
          amount: babz(100),
        },
        {
          address: P2_ADDR,
          amount: babz(400),
        },
        {
          address: P3_ADDR,
          amount: babz(300),
        },
      ],
      2,
      4,
    );
    expect(balances[P1_ADDR].toString()).eq(babz(100).toString());
    expect(balances[P2_ADDR].toString()).eq(babz(370).toString());
    expect(balances[P3_ADDR].toString()).eq(babz(250).toString());
  });

  it('should handle HandComplete event.', (done) => {
    const event = {
      Subject: `HandComplete::${TABLE_ADDR}`,
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(1),
      /* addresses:  */[EMPTY_ADDR, P1_ADDR, P2_ADDR],
      /* balances:   */[babz(0), babz(50000), babz(50000)],
      /* exitHands:  */[babz(0), babz(0), babz(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, babz(50));
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 2,
      dealer: 0,
      state: 'preflop',
      type: 'cashgame',
      lineup: [{
        address: EMPTY_ADDR,
      }, {
        address: P1_ADDR,
        last: new Receipt(EMPTY_ADDR).fold(2, babz(500)).sign(P1_PRIV),
      }, {
        address: P2_ADDR,
        last: new Receipt(EMPTY_ADDR).bet(2, babz(1000)).sign(P2_PRIV),
      }],
      deck,
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255'), new Db(dynamo), ORACLE_PRIV, logger);
    Promise.all(worker.process(event)).then(() => {
      expect(dynamo.putItem).calledWith({ Item: {
        TABLE_ADDR,
        handId: 3,
        deck: sinon.match.any,
        state: 'waiting',
        type: 'cashgame',
        dealer: 1,
        sb: babz(50).toNumber(),
        lineup: [{ address: EMPTY_ADDR }, { address: P1_ADDR }, { address: P2_ADDR }],
        changed: sinon.match.any,
        started: sinon.match.any,
      },
        TableName: 'sb_cashgame' });
      const distHand2 = new Receipt(TABLE_ADDR).dist(
        2,
        0,
        [babz(0), babz(0), babz(1485)],
      ).sign(ORACLE_PRIV);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':d', distHand2)));
      expect(sentry.captureMessage).calledWith(sinon.match(`HandComplete: ${TABLE_ADDR}`), sinon.match.any);
      expect(sentry.captureMessage).calledWith(sinon.match(`NewHand: ${TABLE_ADDR}`), {
        extra: sinon.match.any,
        level: 'info',
        server_name: 'event-worker',
        tags: { handId: 3, TABLE_ADDR },
      });
      done();
    }).catch(done);
  });

  it('should handle HandComplete event with empty seats.', (done) => {
    const event = {
      Subject: `HandComplete::${TABLE_ADDR}`,
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(1),
      [P1_ADDR, P2_ADDR, P3_ADDR, P4_ADDR, EMPTY_ADDR],
      [babz(3000), babz(3000), babz(3000), babz(3000), babz(0)],
      [babz(0), babz(0), babz(0), babz(0), babz(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, babz(50));
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 2,
      dealer: 3,
      state: 'showdown',
      type: 'cashgame',
      lineup: [{
        address: P1_ADDR,
        last: new Receipt(EMPTY_ADDR).fold(2, babz(350)).sign(P1_PRIV),
      }, {
        address: P2_ADDR,
        last: new Receipt(EMPTY_ADDR).bet(2, babz(850)).sign(P2_PRIV),
      }, {
        address: P3_ADDR,
        last: new Receipt(EMPTY_ADDR).show(2, babz(850)).sign(P3_PRIV),
        cards: [9, 23],
      }, {
        address: P4_ADDR,
        last: new Receipt(EMPTY_ADDR).fold(2, babz(350)).sign(P4_PRIV),
      }, {
        address: EMPTY_ADDR,
      }],
      deck: [35, 21, 13, 1, 9, 23, 25, 15,
        44, 43, 39, 22, 34, 24, 10, 4, 38, 18, 11, 2, 31, 51, 49, 50, 41, 28],
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255'), new Db(dynamo), ORACLE_PRIV, logger);
    Promise.all(worker.process(event)).then(() => {
      expect(dynamo.putItem).calledWith({ Item: {
        TABLE_ADDR,
        handId: 3,
        deck: sinon.match.any,
        state: 'waiting',
        type: 'cashgame',
        dealer: 0,
        sb: babz(50).toNumber(),
        lineup: [{
          address: P1_ADDR,
        }, {
          address: P2_ADDR,
        }, {
          address: P3_ADDR,
        }, {
          address: P4_ADDR,
        }, {
          address: EMPTY_ADDR,
        }],
        changed: sinon.match.any,
        started: sinon.match.any,
      },
        TableName: 'sb_cashgame' });
      const distHand2 = new Receipt(TABLE_ADDR).dist(
        2,
        0,
        [babz(0), babz(0), babz(2376), babz(24)],
      ).sign(ORACLE_PRIV);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':d', distHand2)));
      done();
    }).catch(done);
  });

  it('should create pre-showdown distribution.', (done) => {
    const event = {
      Subject: `HandComplete::${TABLE_ADDR}`,
      Message: JSON.stringify({ TABLE_ADDR, handId: 2 }),
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [
      new BigNumber(1),
      [P1_ADDR, P2_ADDR],
      [babz(500), babz(500)],
      [babz(0), babz(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, babz(50));
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 2,
      lineup: [{
        address: P1_ADDR,
        last: new Receipt(TABLE_ADDR).fold(2, babz(200)).sign(P1_PRIV),
      }, {
        address: P2_ADDR,
        last: new Receipt(TABLE_ADDR).bet(2, babz(500)).sign(P2_PRIV),
        sitout: 'allin',
      }],
      state: 'turn',
      type: 'cashgame',
      deck,
      dealer: 0,
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255'), new Db(dynamo), ORACLE_PRIV, logger);
    Promise.all(worker.process(event)).then(() => {
      const distHand2 = new Receipt(TABLE_ADDR).dist(2, 0, [babz(0), babz(693)]).sign(ORACLE_PRIV);
      expect(dynamo.updateItem).calledWith(
        sinon.match.has('ExpressionAttributeValues', sinon.match.has(':d', distHand2)));
      expect(dynamo.putItem).calledWith({ Item: {
        TABLE_ADDR,
        handId: 3,
        deck: sinon.match.any,
        state: 'waiting',
        type: 'cashgame',
        dealer: 1,
        sb: babz(50).toNumber(),
        lineup: [{
          address: P1_ADDR,
        }, {
          address: P2_ADDR,
        }],
        changed: sinon.match.any,
        started: sinon.match.any,
      },
        TableName: 'sb_cashgame' });
      done();
    }).catch(done);
  });

  it('should put broke players into sitout and active players back from sitout.', (done) => {
    const event = {
      Subject: `HandComplete::${TABLE_ADDR}`,
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(2),
      [P1_ADDR, P3_ADDR, P2_ADDR],
      [babz(50000), babz(10000), babz(1000)],
      [babz(0), babz(0), babz(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, babz(50));
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 3,
      state: 'showdown',
      type: 'cashgame',
      lineup: [{
        address: P1_ADDR,
        last: new Receipt(EMPTY_ADDR).show(3, babz(1000)).sign(P1_PRIV),
        cards: [24, 25],
      }, {
        address: P3_ADDR,
        last: new Receipt(EMPTY_ADDR).sitOut(3, babz(100)).sign(P3_PRIV),
      }, {
        address: P2_ADDR,
        last: new Receipt(EMPTY_ADDR).show(3, babz(1000)).sign(P2_PRIV),
        cards: [4, 5],
      }],
      changed: 234,
      deck: [24, 25, 0, 1, 4, 5, 6, 7, 8, 9,
        10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 2, 3],
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255'), new Db(dynamo), ORACLE_PRIV, logger);
    Promise.all(worker.process(event)).then(() => {
      const distHand3 = new Receipt(TABLE_ADDR).dist(3, 0, [babz(2079)]).sign(ORACLE_PRIV);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':d', distHand3)));
      expect(dynamo.putItem).calledWith({ Item: {
        TABLE_ADDR,
        handId: 4,
        deck: sinon.match.any,
        state: 'waiting',
        type: 'cashgame',
        dealer: 0,
        sb: babz(50).toNumber(),
        lineup: [{
          address: P1_ADDR,
        }, {
          address: P3_ADDR,
        }, {
          address: P2_ADDR,
          sitout: sinon.match.any,
        }],
        changed: sinon.match.any,
        started: sinon.match.any,
      },
        TableName: 'sb_cashgame' });
      done();
    }).catch(done);
  });

  it('should put leaving player into sitout.', (done) => {
    const event = {
      Subject: `HandComplete::${TABLE_ADDR}`,
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(2),
      [P1_ADDR, P2_ADDR],
      [babz(50000), babz(50000)],
      // P1 has exit hand at 3
      [new BigNumber(3), babz(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, babz(50));
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 3,
      state: 'showdown',
      type: 'cashgame',
      lineup: [{
        address: P1_ADDR,
        last: new Receipt(EMPTY_ADDR).show(3, babz(1000)).sign(P1_PRIV),
        cards: [24, 25],
      }, {
        address: P2_ADDR,
        last: new Receipt(EMPTY_ADDR).show(3, babz(1000)).sign(P2_PRIV),
        cards: [0, 1],
      }],
      changed: 234,
      deck: [24, 25, 0, 1, 4, 5, 6, 7, 8,
        9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 2, 3],
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255'), new Db(dynamo), ORACLE_PRIV, logger);
    Promise.all(worker.process(event)).then(() => {
      const distHand3 = new Receipt(TABLE_ADDR).dist(3, 0, [babz(1980)]).sign(ORACLE_PRIV);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':d', distHand3)));
      expect(dynamo.putItem).calledWith({ Item: {
        TABLE_ADDR,
        handId: 4,
        deck: sinon.match.any,
        state: 'waiting',
        type: 'cashgame',
        dealer: 1,
        sb: babz(50).toNumber(),
        lineup: [{
          address: P1_ADDR,
          sitout: 1,
          exitHand: 3,
        }, {
          address: P2_ADDR,
        }],
        changed: sinon.match.any,
        started: sinon.match.any,
      },
        TableName: 'sb_cashgame' });
      done();
    }).catch(done);
  });

  it('should handle exitHand flag.', (done) => {
    const event = {
      Subject: `HandComplete::${TABLE_ADDR}`,
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(2),
      [P1_ADDR, P2_ADDR],
      [babz(50000), babz(50000)],
      // P1 will exit at hand 3, but the tx is not mined yet
      [babz(0), babz(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, babz(50));
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 3,
      state: 'showdown',
      type: 'cashgame',
      lineup: [{
        address: P1_ADDR,
        last: new Receipt(EMPTY_ADDR).show(3, babz(1000)).sign(P1_PRIV),
        cards: [24, 25],
        exitHand: 3,
      }, {
        address: P2_ADDR,
        last: new Receipt(EMPTY_ADDR).show(3, babz(1000)).sign(P2_PRIV),
        cards: [0, 1],
      }],
      changed: 234,
      deck: [24, 25, 0, 1, 4, 5, 6, 7, 8,
        9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 2, 3],
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255'), new Db(dynamo), ORACLE_PRIV, logger);
    Promise.all(worker.process(event)).then(() => {
      const distHand3 = new Receipt(TABLE_ADDR).dist(3, 0, [babz(1980)]).sign(ORACLE_PRIV);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':d', distHand3)));
      expect(dynamo.putItem).calledWith({ Item: {
        TABLE_ADDR,
        handId: 4,
        deck: sinon.match.any,
        state: 'waiting',
        type: 'cashgame',
        dealer: 1,
        sb: babz(50).toNumber(),
        lineup: [{
          address: P1_ADDR,
          sitout: 1,
          exitHand: 3,
        }, {
          address: P2_ADDR,
        }],
        changed: sinon.match.any,
        started: sinon.match.any,
      },
        TableName: 'sb_cashgame' });
      done();
    }).catch(done);
  });

  it('should calc dist for showdown with 2 winners and odd amounts.', (done) => {
    const event = {
      Subject: `HandComplete::${TABLE_ADDR}`,
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(3),
      [P1_ADDR, P2_ADDR],
      [babz(50000), babz(1000)],
      [babz(0), babz(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 4,
      state: 'showdown',
      lineup: [{
        address: P1_ADDR,
        last: new Receipt(EMPTY_ADDR).show(4, babz(1050)).sign(P1_PRIV),
        cards: [0, 1],
      }, {
        address: P2_ADDR,
        last: new Receipt(EMPTY_ADDR).show(4, babz(1050)).sign(P2_PRIV),
        cards: [2, 3],
      }],
      deck,
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255'), new Db(dynamo), ORACLE_PRIV, logger);
    Promise.all(worker.process(event)).then(() => {
      const distHand4 = new Receipt(TABLE_ADDR).dist(
        4,
        0,
        [babz(1039.5), babz(1039.5)],
      ).sign(ORACLE_PRIV);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':d', distHand4)));
      expect(dynamo.putItem).calledWith(sinon.match.has('Item', sinon.match.has('handId', 5)));
      done();
    }).catch(done);
  });

  it('should put broke players into sitout tracking back multiple hands.', (done) => {
    const event = {
      Subject: `HandComplete::${TABLE_ADDR}`,
      Message: JSON.stringify({
        TABLE_ADDR,
        handId: 3,
      }),
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(2),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(2075)],
      [babz(0), babz(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(dynamo, 'batchGetItem').yields(null, { Responses: {
      sb_cashgame: [{
        handId: 3,
        lineup: [{
          address: P1_ADDR,
          last: new Receipt(EMPTY_ADDR).bet(3, babz(500)).sign(P1_PRIV),
        }, {
          address: P2_ADDR,
          last: new Receipt(EMPTY_ADDR).bet(3, babz(1000)).sign(P2_PRIV),
        }],
        distribution: new Receipt(EMPTY_ADDR).dist(3, 0, [babz(1500)]).sign(ORACLE_PRIV),
      }],
    } });
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 4,
      type: 'cashgame',
      lineup: [{
        address: P1_ADDR,
        last: new Receipt(EMPTY_ADDR).bet(4, babz(500)).sign(P1_PRIV),
      }, {
        address: P2_ADDR,
        last: new Receipt(EMPTY_ADDR).bet(4, babz(1000)).sign(P2_PRIV),
      }],
      changed: 123,
      distribution: new Receipt(EMPTY_ADDR).dist(4, 0, [babz(1500)]).sign(ORACLE_PRIV),
    }] });
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(sentry, 'captureException').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255'), new Db(dynamo), null, logger);
    Promise.all(worker.process(event)).then(() => {
      expect(dynamo.putItem).calledWith({ Item: {
        TABLE_ADDR,
        handId: 5,
        deck: sinon.match.any,
        state: 'waiting',
        type: 'cashgame',
        dealer: 0,
        sb: 50,
        lineup: [{
          address: P1_ADDR,
        }, {
          address: P2_ADDR,
          sitout: sinon.match.any,
        }],
        changed: sinon.match.any,
        started: sinon.match.any,
      },
        TableName: 'sb_cashgame' });
      done();
    }).catch(done);
  });


  afterEach(() => {
    if (contract.leave.getData.restore) contract.leave.getData.restore();
    if (contract.settle.getData.restore) contract.settle.getData.restore();
    if (contract.payoutFrom.getData.restore) contract.payoutFrom.getData.restore();
    if (contract.net.getData.restore) contract.net.getData.restore();
    if (contract.create.getData.restore) contract.create.getData.restore();
    if (contract.getLineup.call.restore) contract.getLineup.call.restore();
    if (contract.smallBlind.call.restore) contract.smallBlind.call.restore();
    if (dynamo.getItem.restore) dynamo.getItem.restore();
    if (dynamo.batchGetItem.restore) dynamo.batchGetItem.restore();
    if (dynamo.putItem.restore) dynamo.putItem.restore();
    if (dynamo.query.restore) dynamo.query.restore();
    if (dynamo.updateItem.restore) dynamo.updateItem.restore();
    if (sentry.captureMessage.restore) sentry.captureMessage.restore();
    if (sentry.captureException.restore) sentry.captureException.restore();
  });
});

describe('Stream worker other events', () => {
  it('should handle AddPromo event.', (done) => {
    const event = {
      Subject: 'AddPromo::00000000::2',
      Message: JSON.stringify({}),
    };

    sinon.stub(sdb, 'getAttributes').yields(null, {
      Attributes: [
        { Name: 'allowance', Value: '1' },
      ],
    });
    sinon.stub(sdb, 'putAttributes').yields(null, {});

    const worker = new EventWorker(
      null,
      new Db(dynamo, 'sb_cashgame', sdb, 'promo'),
      ORACLE_PRIV,
      sentry,
    );

    Promise.all(worker.process(event)).then(() => {
      expect(sdb.putAttributes).calledWith({
        DomainName: 'promo',
        ItemName: '00000000',
        Attributes: [
          { Name: 'allowance', Value: '3', Replace: true },
        ],
      });
      done();
    }).catch(done);
  });

  it('should handle TableLeave event.', (done) => {
    const handId = 2;

    const leaveReceipt = new Receipt(TABLE_ADDR).leave(handId, P1_ADDR).sign(ORACLE_PRIV);

    const event = {
      Subject: `TableLeave::${TABLE_ADDR}`,
      Message: JSON.stringify({
        TABLE_ADDR,
        leaverAddr: P1_ADDR,
        exitHand: handId,
      }),
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(handId - 1),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(50000)],
      [babz(0), babz(0)],
    ]);
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 2,
      state: 'waiting',
      lineup: [],
    }] });
    sinon.stub(contract.leave, 'estimateGas').yields(null, 1000);
    sinon.stub(contract.leave, 'getData').returns('0x112233');
    sinon.stub(sentry, 'captureMessage').yields(null, 'sentry');
    sinon.stub(sqs, 'sendMessage').yields(null, {});

    const worker = new EventWorker(
      new Table(factory, web3, '0x1255', sqs, 'url'),
      new Db(dynamo, 'sb_cashgame', sdb, 'promo'),
      ORACLE_PRIV,
      logger,
    );

    Promise.all(worker.process(event)).then(() => {
      expect(sqs.sendMessage).calledWith({
        MessageBody: `{"from":"0x1255","to":"${TABLE_ADDR}","gas":1200,"data":"0x112233"}`,
        MessageGroupId: 'someGroup',
        QueueUrl: 'url',
      }, sinon.match.any);
      expect(sentry.captureMessage).calledWith(sinon.match('tx: table.leave()'), {
        level: 'info',
        server_name: 'event-worker',
        tags: { TABLE_ADDR, handId },
        extra: { leaveReceipt },
      });
      done();
    }).catch(done);
  });

  it('shouldn\'t send leave receipt to contract for tournament table on TableLeave event', (done) => {
    const handId = 2;

    const event = {
      Subject: `TableLeave::${TABLE_ADDR}`,
      Message: JSON.stringify({
        TABLE_ADDR,
        leaverAddr: P1_ADDR,
        exitHand: handId,
      }),
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(handId - 1),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(50000)],
      [babz(0), babz(0)],
    ]);
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 2,
      type: 'tournament',
      state: 'waiting',
      lineup: [],
    }] });
    sinon.stub(contract.leave, 'estimateGas').yields(null, 1000);
    sinon.stub(contract.leave, 'getData').returns('0x112233');
    sinon.stub(sentry, 'captureMessage').yields(null, 'sentry');
    sinon.stub(sqs, 'sendMessage').yields(null, {});

    const worker = new EventWorker(
      new Table(factory, web3, '0x1255', sqs, 'url'),
      new Db(dynamo, 'sb_cashgame', sdb, 'promo'),
      ORACLE_PRIV,
      logger,
    );

    Promise.all(worker.process(event)).then(() => {
      expect(sqs.sendMessage).callCount(0);
      done();
    }).catch(done);
  });

  it('should handle ProgressNetting event.', (done) => {
    const event = { Subject: `ProgressNetting::${TABLE_ADDR}` };
    sinon.stub(contract.net, 'estimateGas').yields(null, 100);
    sinon.stub(contract.net, 'getData').returns('0x112233');
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(sqs, 'sendMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255', sqs, 'url'), null, null, logger);

    Promise.all(worker.process(event)).then(() => {
      expect(sqs.sendMessage).calledWith({
        MessageBody: `{"from":"0x1255","to":"${TABLE_ADDR}","gas":120,"data":"0x112233"}`,
        MessageGroupId: 'someGroup',
        QueueUrl: 'url',
      }, sinon.match.any);
      expect(sentry.captureMessage).calledWith(sinon.match('tx: table.net()'), {
        level: 'info',
        server_name: 'event-worker',
        tags: { TABLE_ADDR },
      });
      done();
    }).catch(done);
  });

  it('should handle HandleDispute event.', (done) => {
    const event = {
      Subject: `HandleDispute::${TABLE_ADDR}`,
      Message: JSON.stringify({
        TABLE_ADDR,
        lastHandNetted: 5,
        lastNettingRequest: 6,
      }),
    };
    sinon.stub(dynamo, 'getItem').yields(null, { Item: {
      lineup: [{
        address: P1_ADDR,
        last: new Receipt(TABLE_ADDR).bet(6, babz(500)).sign(P1_PRIV),
      }, {
        address: P2_ADDR,
        last: new Receipt(TABLE_ADDR).bet(6, babz(1000)).sign(P2_PRIV),
      }],
      distribution: new Receipt(TABLE_ADDR).dist(6, 0, [babz(1500)]).sign(ORACLE_PRIV),
    } });
    sinon.stub(contract.submit, 'getData').returns('0x112233');
    sinon.stub(contract.submit, 'call').yields(null, 1);
    sinon.stub(contract.submit, 'estimateGas').yields(null, 100);
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(sqs, 'sendMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255', sqs, 'url'), new Db(dynamo), null, logger);

    Promise.all(worker.process(event)).then(() => {
      expect(sqs.sendMessage).calledWith({
        MessageBody: `{"from":"0x1255","to":"${TABLE_ADDR}","gas":120,"data":"0x112233"}`,
        MessageGroupId: 'someGroup',
        QueueUrl: 'url',
      }, sinon.match.any);
      done();
    }).catch(done);
  });

  it('should handle TableLeave if netting not needed.', (done) => {
    const handId = 2;
    const leaveReceipt = new Receipt(TABLE_ADDR).leave(handId, P1_ADDR).sign(ORACLE_PRIV);

    const event = {
      Subject: `TableLeave::${TABLE_ADDR}`,
      Message: JSON.stringify({
        TABLE_ADDR,
        leaverAddr: P1_ADDR,
        exitHand: handId,
      }),
    };
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 2,
      state: 'waiting',
      lineup: [],
    }] });
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(handId),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(50000)],
      [babz(0), babz(0)],
    ]);
    sinon.stub(contract.leave, 'getData').returns('0x112233');
    sinon.stub(contract.payoutFrom, 'getData').returns('0x445566');
    sinon.stub(contract.leave, 'estimateGas').yields(null, 100);
    sinon.stub(contract.payoutFrom, 'estimateGas').yields(null, 100);
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(sqs, 'sendMessage').yields(null, {});

    const worker = new EventWorker(
      new Table(factory, web3, '0x1255', sqs, 'url'),
      new Db(dynamo, 'sb_cashgame', sdb, 'promo'),
      ORACLE_PRIV,
      logger,
    );

    Promise.all(worker.process(event)).then(() => {
      expect(sqs.sendMessage).calledWith({
        MessageBody: `{"from":"0x1255","to":"${TABLE_ADDR}","gas":120,"data":"0x112233"}`,
        MessageGroupId: 'someGroup',
        QueueUrl: 'url',
      }, sinon.match.any);
      expect(sentry.captureMessage).callCount(1);
      expect(sentry.captureMessage).calledWith(sinon.match('tx: table.leave()'), {
        level: 'info',
        server_name: 'event-worker',
        tags: { TABLE_ADDR, handId },
        extra: { leaveReceipt },
      });

      done();
    }).catch(done);
  });

  it('should handle Kick.', (done) => {
    const event = {
      Subject: `Kick::${TABLE_ADDR}`,
      Message: JSON.stringify({
        TABLE_ADDR,
        pos: 0,
      }),
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(2),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(50000)],
      [babz(0), babz(0)],
    ]);
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 3,
      state: 'waiting',
      lineup: [{
        address: P1_ADDR,
        sitout: 1,
      }, {
        address: P2_ADDR,
      }],
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(contract.leave, 'getData').returns('0x112233');
    sinon.stub(contract.leave, 'estimateGas').yields(null, 1000);
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(contract.payoutFrom, 'getData').returns('0x445566');
    sinon.stub(sqs, 'sendMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255', sqs, 'url'), new Db(dynamo), ORACLE_PRIV, logger);

    Promise.all(worker.process(event)).then(() => {
      const leaveReceipt = new Receipt(TABLE_ADDR).leave(2, P1_ADDR).sign(ORACLE_PRIV);
      expect(sentry.captureMessage).calledWith(sinon.match('tx: table.leave()'), {
        level: 'info',
        server_name: 'event-worker',
        tags: { TABLE_ADDR, handId: 2 },
        extra: { leaveReceipt },
      });
      expect(dynamo.updateItem).callCount(2);
      expect(dynamo.updateItem).calledWith(
          sinon.match.has('ExpressionAttributeValues',
            sinon.match.has(':h', 2),
          ));
      done();
    }).catch(done);
  });

  it('should handle new Table.', (done) => {
    const event = { Subject: `HandComplete::${TABLE_ADDR}`, Message: '' };
    sinon.stub(dynamo, 'query').yields(null, { Items: [] });
    sinon.stub(contract.getLineup, 'call').yields(null, [babz(0),
      [EMPTY_ADDR, EMPTY_ADDR],
      [babz(0), babz(0)],
      [babz(0), babz(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(sentry, 'captureException').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255'), new Db(dynamo), null, logger);
    Promise.all(worker.process(event)).then(() => {
      expect(dynamo.putItem).calledWith({ Item: {
        TABLE_ADDR,
        type: 'cashgame',
        handId: 1,
        deck: sinon.match.any,
        state: 'waiting',
        dealer: 0,
        sb: 50,
        lineup: [{ address: EMPTY_ADDR }, { address: EMPTY_ADDR }],
        changed: sinon.match.any,
        started: sinon.match.any,
      },
        TableName: 'sb_cashgame' });
      done();
    }).catch(done);
  });

  // create netting when hand with leaving player turns complete.
  it('should handle TableNettingRequest event.', (done) => {
    const event = {
      Subject: `TableNettingRequest::${TABLE_ADDR}`,
      Message: JSON.stringify({
        TABLE_ADDR,
        handId: 2,
      }),
    };
    sinon.stub(contract.smallBlind, 'call').yields(null, babz(50));
    sinon.stub(contract.getLineup, 'call').yields(null, [babz(0),
      [P1_ADDR, P2_ADDR, EMPTY_ADDR],
      [babz(50000), babz(50000), babz(0)],
      [babz(0), new BigNumber(2), babz(0)],
    ]);
    sinon.stub(dynamo, 'getItem').yields(null, { Item: {
      lineup: [{
        address: P1_ADDR,
        last: new Receipt(EMPTY_ADDR).fold(2, babz(500)).sign(P1_PRIV),
      }, {
        address: P2_ADDR,
        last: new Receipt(EMPTY_ADDR).bet(2, babz(1000)).sign(P2_PRIV),
        lastHand: 2,
        leaveReceipt: '0x99',
      }, {
        address: EMPTY_ADDR,
      }],
      distribution: new Receipt(EMPTY_ADDR).dist(2, 0, [babz(0), babz(1500)]).sign(ORACLE_PRIV),
    } }).onFirstCall().yields(null, { Item: {
      lineup: [{
        address: P1_ADDR,
        last: new Receipt(EMPTY_ADDR).bet(1, babz(10000)).sign(P1_PRIV),
      }, {
        address: P2_ADDR,
        last: new Receipt(EMPTY_ADDR).bet(1, babz(10000)).sign(P2_PRIV),
      }, {
        address: EMPTY_ADDR,
      }],
      distribution: new Receipt(EMPTY_ADDR).dist(1, 0, [babz(20000)]).sign(ORACLE_PRIV),
    } });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255'), new Db(dynamo), ORACLE_PRIV, logger);
    Promise.all(worker.process(event)).then(() => {
      const netting = {
        '0x82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f': '0x1ccf13cf61b8e66a91e1964cf07b30c715ff83b9e00cb36bcdb423fbfdcfba4a6237d92a84fd463bb6bdf37ea5bf077da37947839e1d031827d557124edbd9daab',
        newBalances: '0x00a7020000000090f560ffffff6f0aa0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      };
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':n', netting)));
      done();
    }).catch(done);
  });

  it('should prevent TableNettingRequest event from overwriting netting.', (done) => {
    const event = {
      Subject: 'TableNettingRequest::0xa2decf075b96c8e5858279b31f644501a140e8a7',
      Message: JSON.stringify({
        tableAddr: '0xa2decf075b96c8e5858279b31f644501a140e8a7',
        handId: 2,
      }),
    };
    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, [babz(0),
      [P1_ADDR, P2_ADDR, EMPTY_ADDR],
      [new BigNumber(50000), new BigNumber(50000), babz(0)],
      [babz(0), new BigNumber(2), babz(0)],
    ]);
    sinon.stub(dynamo, 'getItem').yields(null, { Item: {
      netting: {},
    } }).onFirstCall().yields(null, { Item: {} });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255'), new Db(dynamo), ORACLE_PRIV, logger);
    Promise.all(worker.process(event)).then(() => {
      expect(dynamo.updateItem).callCount(0);
      done();
    }).catch(done);
  });

  // submit netting when netting complete.
  it('should handle TableNettingComplete event.', (done) => {
    const event = {
      Subject: 'TableNettingComplete::0x1234',
      Message: JSON.stringify({
        tableAddr: '0x77aabb11ee00',
        handId: 2,
      }),
    };
    const bals = '0x11223311223311223311223311223311223311223311223311223311223311228899aabbccddeeff8899aabbccddeeff8899aabbccddeeff8899aabbccddeeff';
    sinon.stub(dynamo, 'getItem').yields(null, { Item: {
      netting: {
        newBalances: bals,
        [ORACLE_ADDR]: '0x223344',
        [P1_ADDR]: '0x334455',
        [P2_ADDR]: '0x445566',
      },
    } });
    sinon.stub(contract.settle, 'getData').returns('0x123456');
    sinon.stub(contract.settle, 'estimateGas').yields(null, 100);
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(sqs, 'sendMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255', sqs, 'url'), new Db(dynamo), null, logger);
    Promise.all(worker.process(event)).then(() => {
      expect(sentry.captureMessage).calledWith(sinon.match('tx: table.settle()'), {
        level: 'info',
        server_name: 'event-worker',
        tags: { tableAddr: '0x77aabb11ee00' },
        extra: { bals, sigs: '0x223344334455445566' },
      });
      // expect hand is marked as netted in db
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':is_n', true)));
      done();
    }).catch(done);
  });

  // submit netting when netting complete.
  it('should ignore TableNettingComplete event if hand is already netted.', (done) => {
    const event = {
      Subject: 'TableNettingComplete::0x1234',
      Message: JSON.stringify({
        tableAddr: '0x77aabb11ee00',
        handId: 2,
      }),
    };
    const bals = '0x11223311223311223311223311223311223311223311223311223311223311228899aabbccddeeff8899aabbccddeeff8899aabbccddeeff8899aabbccddeeff';
    sinon.stub(dynamo, 'getItem').yields(null, { Item: {
      is_netted: true,
      netting: {
        newBalances: bals,
        [ORACLE_ADDR]: '0x223344',
        [P1_ADDR]: '0x334455',
        [P2_ADDR]: '0x445566',
      },
    } });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(sqs, 'sendMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255', sqs, 'url'), new Db(dynamo), null, logger);
    Promise.all(worker.process(event)).then(() => {
      expect(sentry.captureMessage).callCount(0);
      done();
    }).catch(done);
  });

  it('should handle WalletCreated event.', (done) => {
    const event = {
      Subject: 'WalletCreated::0x1234',
      Message: JSON.stringify({
        signerAddr: P2_ADDR,
        email: 'test@mail.com',
        accountId: 'someuuid',
      }),
    };
    sinon.stub(contract.create, 'getData').returns('0x123456');
    sinon.stub(contract.create, 'estimateGas').yields(null, 100);
    sinon.stub(http, 'request').yields(null, { statusCode: 200 }, {});

    const mailer = new MailerLite(http.request, '1234', '4567');

    const worker = new EventWorker(null, null, null, logger, ORACLE_PRIV, mailer, null, pusher);
    Promise.all(worker.process(event)).then(() => {
      expect(http.request).calledWith({
        body: '{"email":"test@mail.com"}',
        headers: { 'Content-Type': 'application/json', 'X-MailerLite-ApiKey': '1234' },
        method: 'POST',
        url: 'https://api.mailerlite.com/api/v2/groups/4567/subscribers',
      });
      done();
    }).catch(done);
  });

  it('should handle ToggleTable event.', (done) => {
    const senderAddr = '0x3322';
    const event = {
      Subject: `ToggleTable::${P1_ADDR}`,
      Message: '{}',
    };
    sinon.stub(contract.toggleActive, 'getData').returns('0x123456');
    sinon.stub(contract.toggleActive, 'estimateGas').yields(null, 100);
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(12));
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(sqs, 'sendMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, senderAddr, sqs, 'url'), null, ORACLE_PRIV);
    Promise.all(worker.process(event)).then(() => {
      expect(sqs.sendMessage).calledWith({
        MessageBody: `{"from":"0x3322","to":"${P1_ADDR}","gas":120,"data":"0x123456"}`,
        MessageGroupId: 'someGroup',
        QueueUrl: 'url',
      }, sinon.match.any);
      done();
    }).catch(done);
  });

  // payout players after Netted event.
  it('should handle Netted event in table.', (done) => {
    const event = {
      Subject: 'ContractEvent::0x77aabb11ee00',
      Message: JSON.stringify({
        address: '0x77aabb11ee00',
        event: 'Netted',
        args: {},
      }),
    };
    const lineup = [
      new BigNumber(3),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(50000)],
      [babz(0), new BigNumber(2)],
    ];
    sinon.stub(dynamo, 'query').yields(null, { Items: [{ handId: 2 }] });
    sinon.stub(dynamo, 'deleteItem').yields(null, {});
    sinon.stub(contract.getLineup, 'call').yields(null, lineup);
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255'), new Db(dynamo), null, logger);
    Promise.all(worker.process(event)).then(() => {
      expect(dynamo.deleteItem).callCount(1);
      expect(dynamo.deleteItem).calledWith({ Key: {
        handId: 2,
        tableAddr: '0x77aabb11ee00',
      },
        TableName: 'sb_cashgame' });
      done();
    }).catch(done);
  });

  // payout multiple players after Netted event.
  it('should handle Netted event in table for multiple players.', (done) => {
    const event = {
      Subject: 'ContractEvent::0x77aabb11ee00',
      Message: JSON.stringify({
        address: '0x77aabb11ee00',
        event: 'Netted',
        args: {},
      }),
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(3),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(50000)],
      [new BigNumber(1), new BigNumber(2)],
    ]);
    sinon.stub(dynamo, 'query').yields(null, { Items: [{ handId: 2 }] });
    sinon.stub(dynamo, 'deleteItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(factory, web3, '0x1255'), new Db(dynamo), null, logger);
    Promise.all(worker.process(event)).then(() => {
      expect(dynamo.deleteItem).callCount(1);
      expect(dynamo.deleteItem).calledWith({ Key: {
        handId: 2,
        tableAddr: '0x77aabb11ee00',
      },
        TableName: 'sb_cashgame' });
      done();
    }).catch(done);
  });

  it('should handle Table join.', (done) => {
    const event = {
      Subject: 'ContractEvent::0x77aabb11ee00',
      Message: JSON.stringify({
        address: '0x77aabb11ee00',
        event: 'Join',
        args: {},
      }),
    };
    sinon.stub(lambda, 'invoke').yields(null, {});

    const worker = new EventWorker(null, null, null, null, null, null, new Lambda(lambda, 'test'));
    Promise.all(worker.process(event)).then(() => {
      expect(lambda.invoke).callCount(1);
      expect(lambda.invoke).calledWith({
        FunctionName: 'test',
        InvocationType: 'Event',
        Payload: '{"params":{"path":{"tableAddr":"0x77aabb11ee00"}},"context":{"resource-path":"lineup"}}',
      }, sinon.match.any);
      done();
    }).catch(done);
  });

  it('should handle Table leave.', (done) => {
    const event = {
      Subject: 'ContractEvent::0x77aabb11ee00',
      Message: JSON.stringify({
        address: '0x77aabb11ee00',
        event: 'Leave',
        args: {},
      }),
    };
    sinon.stub(lambda, 'invoke').yields(null, {});

    const worker = new EventWorker(null, null, null, null, null, null, new Lambda(lambda, 'test'));
    Promise.all(worker.process(event)).then(() => {
      expect(lambda.invoke).callCount(1);
      expect(lambda.invoke).calledWith({
        FunctionName: 'test',
        InvocationType: 'Event',
        Payload: '{"params":{"path":{"tableAddr":"0x77aabb11ee00"}},"context":{"resource-path":"lineup"}}',
      }, sinon.match.any);
      done();
    }).catch(done);
  });

  it('should handle timeout.', (done) => {
    const event = { Subject: 'Timeout::0x77aabb11ee00' };
    sinon.stub(lambda, 'invoke').yields(null, {});

    const worker = new EventWorker(null, null, null, null, null, null, new Lambda(lambda, 'test'));
    Promise.all(worker.process(event)).then(() => {
      expect(lambda.invoke).callCount(1);
      expect(lambda.invoke).calledWith({
        FunctionName: 'test',
        InvocationType: 'Event',
        Payload: '{"params":{"path":{"tableAddr":"0x77aabb11ee00"}},"context":{"resource-path":"timeout"}}',
      }, sinon.match.any);
      done();
    }).catch(done);
  });

  afterEach(() => {
    if (contract.leave.getData.restore) contract.leave.getData.restore();
    if (contract.leave.estimateGas.restore) contract.leave.estimateGas.restore();
    if (contract.settle.getData.restore) contract.settle.getData.restore();
    if (contract.payoutFrom.getData.restore) contract.payoutFrom.getData.restore();
    if (contract.net.getData.restore) contract.net.getData.restore();
    if (contract.create.getData.restore) contract.create.getData.restore();
    if (contract.getLineup.call.restore) contract.getLineup.call.restore();
    if (contract.smallBlind.call.restore) contract.smallBlind.call.restore();
    if (sqs.sendMessage.restore) sqs.sendMessage.restore();
    if (dynamo.getItem.restore) dynamo.getItem.restore();
    if (dynamo.batchGetItem.restore) dynamo.batchGetItem.restore();
    if (dynamo.putItem.restore) dynamo.putItem.restore();
    if (dynamo.query.restore) dynamo.query.restore();
    if (dynamo.updateItem.restore) dynamo.updateItem.restore();
    if (dynamo.deleteItem.restore) dynamo.deleteItem.restore();
    if (sentry.captureMessage.restore) sentry.captureMessage.restore();
    if (sentry.captureException.restore) sentry.captureException.restore();
    if (http.request.restore) http.request.restore();
    if (lambda.invoke.restore) lambda.invoke.restore();
  });
});
