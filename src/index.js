import _ from 'lodash';

const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';

export default class ReserveSerivce {

  constructor(table, pusher, db) {
    this.table = table;
    this.pusher = pusher;
    this.db = db;
  }

  notify(tableAddr, event) {
    return new Promise((resolve, reject) => {
      this.pusher.trigger(tableAddr, 'update', event, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  getReservations(tableAddr) {
    return this.db.getTableReservations(tableAddr);
  }

  async reserve(tableAddr, pos, signerAddr, txHash, amount) {
    try {
      const seat = await this.db.getSeat(tableAddr, pos);

      if (seat) {
        throw new Error('Seat is busy');
      }

      const lineup = await this.table.getLineup(tableAddr);
      if (lineup[1][pos] && lineup[1][pos] !== EMPTY_ADDR) {
        throw new Error('Seat is busy');
      }

      const result = await this.db.reserveSeat(tableAddr, pos, signerAddr, txHash, amount);
      await this.notify(tableAddr, {
        type: 'seatReserve',
        payload: { pos, amount, txHash, signerAddr },
      });
      return result;
    } catch (e) {
      throw e;
    }
  }

  async cleanup(timeout) {
    const deletedItems = await this.db.cleanupOutdated(timeout);
    await Promise.all(_.map(_.groupBy(deletedItems, 'tableAddr'), (items, key) => this.notify(key, {
      type: 'seatsRelease',
      payload: items,
    })));

    return deletedItems;
  }

}
