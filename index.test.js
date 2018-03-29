import chai, { expect } from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import { it, describe, afterEach, beforeEach } from 'mocha';
import Db from './src/db';
import TableContract from './src/tableContract';
import Service from './src/index';

chai.use(sinonChai);

const sdb = {
  getAttributes() {},
  putAttributes() {},
  deleteAttributes() {},
  select() {},
};

const web3 = {
  eth: {
    contract() {},
    at() {},
    getTransaction() {},
    getTransactionReceipt() {},
  },
};

const pusher = {
  trigger() {},
};

const contract = {
  getLineup: { call() {} },
};

const TABLE_ADDR = '0x1f17f994c1a9edcc98fdc59ac5a0f287cd1efc2e';
const TX_HASH = '0x8995de222b85f61928ac83594ee754341ef9a41d67c1b49a610630ae207289bb';
const SIGNER_ADDR = '0x82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f';
const TX_INPUT = '0xd7f31eb9000000000000000000000000179237e4e955369a69bd26499e3b89f6df9e5d7b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a4422810ea0000000000000000000000001f17f994c1a9edcc98fdc59ac5a0f287cd1efc2e0000000000000000000000000000000000000000000000000000246139ca8000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000150032adb84cc8054048448a8696292c0c89030c554b000000000000000000000000000000000000000000000000000000000000000000000000000000';

sinon.stub(web3.eth, 'contract').returns(web3.eth);
sinon.stub(web3.eth, 'at').returns(contract);
sinon.stub(pusher, 'trigger').yields(null);

describe('Reservation Service - reserve seat', () => {
  it('should reserve seat for player and notify about that', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
    );

    sinon.stub(sdb, 'putAttributes').yields(null, { ResponseMetadata: {} });
    sinon.stub(sdb, 'select').yields(null, {});
    sinon.stub(contract.getLineup, 'call').yields(null, [[], [], [], []]);
    sinon.stub(web3.eth, 'getTransaction').yields(null, {
      input: TX_INPUT,
    });

    try {
      await service.reserve(TABLE_ADDR, 0, SIGNER_ADDR, TX_HASH, '10000');
      expect(sdb.putAttributes).calledWith({
        DomainName: 'tableName',
        ItemName: `${TABLE_ADDR}-0`,
        Attributes: [
          { Name: 'tableAddr', Value: TABLE_ADDR },
          { Name: 'pos', Value: '0' },
          { Name: 'signerAddr', Value: SIGNER_ADDR },
          { Name: 'txHash', Value: TX_HASH },
          { Name: 'amount', Value: '10000' },
          { Name: 'created', Value: sinon.match.any },
        ],
      });
      expect(pusher.trigger).calledWith(
        TABLE_ADDR,
        'update',
        {
          type: 'seatReserve',
          payload: {
            pos: '0',
            amount: '10000',
            txHash: TX_HASH,
            signerAddr: SIGNER_ADDR,
          },
        },
      );
    } catch (e) {
      throw e;
    }
  });

  it('should not reserve reserved seat', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
    );

    sinon.stub(sdb, 'select').yields(null, {
      Items: [
        {
          Attributes: [
            { Name: 'pos', Value: '0' },
          ],
        },
      ],
    });
    sinon.stub(web3.eth, 'getTransaction').yields(null, {
      input: TX_INPUT,
    });

    try {
      await service.reserve(TABLE_ADDR, 0, SIGNER_ADDR, TX_HASH, '10000');
    } catch (e) {
      expect(e.message).equal('Seat is busy');
    }
  });

  it('should not reserve seat busy in contract', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
    );

    sinon.stub(sdb, 'select').yields(null, {});
    sinon.stub(contract.getLineup, 'call').yields(null, [[], [
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000000',
    ], [], []]);
    sinon.stub(web3.eth, 'getTransaction').yields(null, {
      input: TX_INPUT,
    });

    try {
      await service.reserve(TABLE_ADDR, 0, SIGNER_ADDR, TX_HASH, '10000');
    } catch (e) {
      expect(e.message).equal('Seat is busy');
    }
  });

  it('should not reserve seat for player that already have reserved seat at table', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
    );

    sinon.stub(sdb, 'select').yields(null, {
      Items: [
        {
          Attributes: [
            { Name: 'pos', Value: '1' },
            { Name: 'signerAddr', Value: SIGNER_ADDR },
          ],
        },
      ],
    });
    sinon.stub(contract.getLineup, 'call').yields(null, [[], [], [], []]);
    sinon.stub(web3.eth, 'getTransaction').yields(null, {
      input: TX_INPUT,
    });

    try {
      await service.reserve(TABLE_ADDR, 0, SIGNER_ADDR, TX_HASH, '10000');
    } catch (e) {
      expect(e.message).equal('Already at table');
    }
  });

  it('should not reserve seat for player already seated at table', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
    );

    sinon.stub(sdb, 'select').yields(null, {});
    sinon.stub(contract.getLineup, 'call').yields(null, [[], [
      '0x0000000000000000000000000000000000000000',
      SIGNER_ADDR,
    ], [], []]);
    sinon.stub(web3.eth, 'getTransaction').yields(null, {
      input: TX_INPUT,
    });

    try {
      await service.reserve(TABLE_ADDR, 0, SIGNER_ADDR, TX_HASH, '10000');
    } catch (e) {
      expect(e.message).equal('Already at table');
    }
  });

  it('should not reserve seat when tableAddr and txHash mismatch', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
    );

    sinon.stub(web3.eth, 'getTransaction').yields(null, {
      input: '',
    });

    try {
      await service.reserve(TABLE_ADDR, 0, SIGNER_ADDR, TX_HASH, '10000');
    } catch (e) {
      expect(e.message).equal('Wrong tableAddr or txHash');
    }
  });

  afterEach(() => {
    if (sdb.getAttributes.restore) sdb.getAttributes.restore();
    if (sdb.putAttributes.restore) sdb.putAttributes.restore();
    if (sdb.deleteAttributes.restore) sdb.deleteAttributes.restore();
    if (sdb.select.restore) sdb.select.restore();
    if (contract.getLineup.call.restore) contract.getLineup.call.restore();
    if (web3.eth.getTransaction.restore) web3.eth.getTransaction.restore();
  });
});

describe('Reservation Service - lineup', () => {
  it('should format table reservations for response', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
    );

    sinon.stub(sdb, 'select').yields(null, {
      Items: [
        {
          Attributes: [
            { Name: 'pos', Value: '0' },
            { Name: 'signerAddr', Value: SIGNER_ADDR },
            { Name: 'amount', Value: '10000' },
            { Name: 'txHash', Value: TX_HASH },
          ],
        },
        {
          Attributes: [
            { Name: 'pos', Value: '2' },
            { Name: 'signerAddr', Value: '0x00' },
            { Name: 'amount', Value: '10000' },
            { Name: 'txHash', Value: TX_HASH },
          ],
        },
      ],
    });

    const lineup = await service.getReservations(TABLE_ADDR);
    expect(lineup[0].signerAddr).eq(SIGNER_ADDR);
    expect(lineup[0].txHash).eq(TX_HASH);
    expect(lineup[0].amount).eq('10000');

    expect(lineup[2].signerAddr).eq('0x00');
    expect(lineup[2].txHash).eq(TX_HASH);
    expect(lineup[2].amount).eq('10000');
  });

  afterEach(() => {
    if (sdb.getAttributes.restore) sdb.getAttributes.restore();
    if (sdb.putAttributes.restore) sdb.putAttributes.restore();
    if (sdb.deleteAttributes.restore) sdb.deleteAttributes.restore();
    if (sdb.select.restore) sdb.select.restore();
    if (contract.getLineup.call.restore) contract.getLineup.call.restore();
    if (web3.eth.getTransaction.restore) web3.eth.getTransaction.restore();
  });
});

describe('Reservation Service - cleanup', () => {
  beforeEach(() => {
    if (pusher.trigger.restore) pusher.trigger.restore();
    sinon.stub(pusher, 'trigger').yields(null);
  });

  it('should return deleted items', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
      web3,
    );

    sinon.stub(web3.eth, 'getTransaction').yields(null, {});
    sinon.stub(web3.eth, 'getTransactionReceipt').yields(null, {});
    sinon.stub(sdb, 'deleteAttributes').yields(null);
    sinon.stub(sdb, 'select').yields(null, {
      Items: [
        {
          Name: `${TABLE_ADDR}-0`,
          Attributes: [
            { Name: 'pos', Value: '0' },
            { Name: 'signerAddr', Value: SIGNER_ADDR },
            { Name: 'tableAddr', Value: TABLE_ADDR },
            { Name: 'amount', Value: '10000' },
            { Name: 'txHash', Value: TX_HASH },
          ],
        },
        {
          Name: '0x111222333444-0',
          Attributes: [
            { Name: 'pos', Value: '0' },
            { Name: 'signerAddr', Value: '0x00' },
            { Name: 'tableAddr', Value: '0x111222333444' },
            { Name: 'amount', Value: '10000' },
            { Name: 'txHash', Value: TX_HASH },
          ],
        },
      ],
    });

    const deletedItems = await service.cleanup(60);

    expect(sdb.deleteAttributes).callCount(2);
    expect(deletedItems).length(2);
    expect(deletedItems[0].tableAddr).eq(TABLE_ADDR);
    expect(deletedItems[1].tableAddr).eq('0x111222333444');
  });

  it('should not remove items if tx is not mined', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
      web3,
    );

    sinon.stub(web3.eth, 'getTransaction').yields(null, {});
    sinon.stub(web3.eth, 'getTransactionReceipt').yields(null, null);
    sinon.stub(sdb, 'deleteAttributes').yields(null);
    sinon.stub(sdb, 'select').yields(null, {
      Items: [
        {
          Name: `${TABLE_ADDR}-0`,
          Attributes: [
            { Name: 'pos', Value: '0' },
            { Name: 'signerAddr', Value: SIGNER_ADDR },
            { Name: 'tableAddr', Value: TABLE_ADDR },
            { Name: 'amount', Value: '10000' },
            { Name: 'txHash', Value: TX_HASH },
          ],
        },
        {
          Name: '0x111222333444-0',
          Attributes: [
            { Name: 'pos', Value: '0' },
            { Name: 'signerAddr', Value: '0x00' },
            { Name: 'tableAddr', Value: '0x111222333444' },
            { Name: 'amount', Value: '10000' },
            { Name: 'txHash', Value: TX_HASH },
          ],
        },
      ],
    });

    const deletedItems = await service.cleanup(60);

    expect(sdb.deleteAttributes).callCount(0);
    expect(deletedItems).length(0);
  });

  it('should remove items if tx is not exists', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
      web3,
    );

    sinon.stub(web3.eth, 'getTransaction').yields(null, null);
    sinon.stub(sdb, 'deleteAttributes').yields(null);
    sinon.stub(sdb, 'select').yields(null, {
      Items: [
        {
          Name: `${TABLE_ADDR}-0`,
          Attributes: [
            { Name: 'pos', Value: '0' },
            { Name: 'signerAddr', Value: SIGNER_ADDR },
            { Name: 'tableAddr', Value: TABLE_ADDR },
            { Name: 'amount', Value: '10000' },
            { Name: 'txHash', Value: TX_HASH },
          ],
        },
        {
          Name: '0x111222333444-0',
          Attributes: [
            { Name: 'pos', Value: '0' },
            { Name: 'signerAddr', Value: '0x00' },
            { Name: 'tableAddr', Value: '0x111222333444' },
            { Name: 'amount', Value: '10000' },
            { Name: 'txHash', Value: TX_HASH },
          ],
        },
      ],
    });

    const deletedItems = await service.cleanup(60);

    expect(sdb.deleteAttributes).callCount(2);
    expect(deletedItems).length(2);
  });

  it('should notify about deleted items', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
      web3,
    );

    sinon.stub(sdb, 'deleteAttributes').yields(null);
    sinon.stub(web3.eth, 'getTransaction').yields(null, {});
    sinon.stub(web3.eth, 'getTransactionReceipt').yields(null, {});
    sinon.stub(sdb, 'select').yields(null, {
      Items: [
        {
          Name: `${TABLE_ADDR}-0`,
          Attributes: [
            { Name: 'pos', Value: '0' },
            { Name: 'signerAddr', Value: SIGNER_ADDR },
            { Name: 'tableAddr', Value: TABLE_ADDR },
            { Name: 'amount', Value: '10000' },
            { Name: 'txHash', Value: TX_HASH },
          ],
        },
        {
          Name: '0x111222333444-0',
          Attributes: [
            { Name: 'pos', Value: '0' },
            { Name: 'signerAddr', Value: '0x00' },
            { Name: 'tableAddr', Value: '0x111222333444' },
            { Name: 'amount', Value: '10000' },
            { Name: 'txHash', Value: TX_HASH },
          ],
        },
      ],
    });

    await service.cleanup(60);

    expect(pusher.trigger).callCount(2);
  });

  afterEach(() => {
    if (sdb.getAttributes.restore) sdb.getAttributes.restore();
    if (sdb.putAttributes.restore) sdb.putAttributes.restore();
    if (sdb.deleteAttributes.restore) sdb.deleteAttributes.restore();
    if (sdb.select.restore) sdb.select.restore();
    if (contract.getLineup.call.restore) contract.getLineup.call.restore();
    if (web3.eth.getTransaction.restore) web3.eth.getTransaction.restore();
    if (web3.eth.getTransactionReceipt.restore) web3.eth.getTransactionReceipt.restore();
  });
});
