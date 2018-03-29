import poly from 'buffer-v6-polyfill'; // eslint-disable-line no-unused-vars
import BigNumber from 'bignumber.js';

const babz = ntz => new BigNumber(10).pow(12).mul(ntz);
const wei = eth => new BigNumber(10).pow(18).mul(eth);

const fundingTimestamps = {};

export default class Faucet {
  constructor(nutz, logger, ntzThreshold = 1000, ethThreshold = 0.1) {
    this.nutz = nutz;
    this.logger = logger;

    this.babzThreshold = babz(ntzThreshold);
    this.weiThreshold = wei(ethThreshold);
  }

  async requestFunds(signerAddr) {
    const tasks = [];

    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    if (
      !fundingTimestamps[signerAddr] ||
      fundingTimestamps[signerAddr] < tenMinutesAgo
    ) {
      const babzBalance = await this.nutz.balanceOf(signerAddr);
      if (this.babzThreshold.gt(babzBalance)) {
        tasks.push(this.nutz.transfer(signerAddr, this.babzThreshold.sub(babzBalance)));
      }

      const weiBalance = await this.nutz.weiBalance(signerAddr);
      if (this.weiThreshold.gt(weiBalance)) {
        tasks.push(this.nutz.sendEth(signerAddr, this.weiThreshold.sub(weiBalance)));
      }
    }

    if (tasks.length > 0) {
      fundingTimestamps[signerAddr] = Date.now();
    }
    await Promise.all(tasks);

    return tasks.length > 0;
  }
}
