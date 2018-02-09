import poly from 'buffer-v6-polyfill'; // eslint-disable-line no-unused-vars
import BigNumber from 'bignumber.js';

const babz = ntz => new BigNumber(10).pow(12).mul(ntz);
const wei = eth => new BigNumber(10).pow(18).mul(eth);

export default class Faucet {
  constructor(nutz, logger) {
    this.nutz = nutz;
    this.logger = logger;
  }

  async requestFunds(signerAddr) {
    const tasks = [];

    const babzBalance = await this.nutz.balanceOf(signerAddr);
    if (babz(1000).gt(babzBalance)) { // < 1000 NTZ
      tasks.push(this.nutz.transfer(signerAddr, babz(1000).sub(babzBalance)));
    }

    const weiBalance = await this.nutz.weiBalance(signerAddr);
    if (wei(0.1).gt(weiBalance)) { // < 0.1 NTZ
      tasks.push(this.nutz.sendEth(signerAddr, wei(0.1).sub(weiBalance)));
    }

    await Promise.all(tasks);

    return true;
  }
}
