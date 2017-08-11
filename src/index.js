const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';

export default class ReserveSerivce {

  constructor(table, pusher, db) {
    this.table = table;
    this.pusher = pusher;
    this.db = db;
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
      if (lineup[1][pos] !== EMPTY_ADDR) {
        throw new Error('Seat is busy');
      }

      const result = await this.db.reserveSeat(tableAddr, pos, signerAddr, txHash, amount);
      // notify through pusher
      return result;
    } catch (e) {
      throw e;
    }
  }

  async cleanup(timeout) {
    const deletedItems = await this.db.cleanup(timeout);
    deletedItems.forEach((item) => {
      console.log('notify', item);
      // notify about deleted reservation through pusher
    });
  }

}
