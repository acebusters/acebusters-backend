import poly from 'buffer-v6-polyfill'; // eslint-disable-line no-unused-vars
import BigNumber from 'bignumber.js';

const babz = ntz => new BigNumber(10).pow(12).mul(ntz);
const wei = eth => new BigNumber(10).pow(18).mul(eth);

export default class Faucet {
  constructor(nutz, logger, ntzThreshold = 1000, ethThreshold = 0.1) {
    this.nutz = nutz;
    this.logger = logger;

    this.babzThreshold = babz(ntzThreshold);
    this.weiThreshold = wei(ethThreshold);
  }

  async requestFunds(signerAddr) {
    const tasks = [];

    const babzBalance = await this.nutz.balanceOf(signerAddr);
    if (this.babzThreshold.gt(babzBalance)) {
      tasks.push(this.nutz.transfer(signerAddr, this.babzThreshold.sub(babzBalance)));
    }

    const weiBalance = await this.nutz.weiBalance(signerAddr);
    if (this.weiThreshold.gt(weiBalance)) {
      tasks.push(this.nutz.sendEth(signerAddr, this.weiThreshold.sub(weiBalance)));
    }

    await Promise.all(tasks);

    return true;
  }
}
