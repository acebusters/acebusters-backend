import chai from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import { it, describe, afterEach } from 'mocha';

chai.use(sinonChai);

const sdb = {
  getAttributes() {},
  putAttributes() {},
  deleteAttributes() {},
  select() {},
};

const sns = {
  publish() {},
};

const recaptcha = {
  verify() {},
};

const ses = {
  sendEmail() {},
};

const sqs = {
  sendMessage() {},
};

const contract = {
  forward: {
    getData() {},
    estimateGas() {},
  },
  getAccount: {
    call() {},
  },
  getOwner: {
    call() {},
  },
  isLocked: {
    call() {},
  },
};

const web3 = { eth: {
  contract() {},
  at() {},
} };

sinon.stub(web3.eth, 'contract').returns(web3.eth);
sinon.stub(web3.eth, 'at', address => ({ ...contract, address }));


describe('Account-less faucet', () => {
  it('should send 1000 NTZ to empty wallet', async () => {
  });

  afterEach(() => {
    if (sdb.getAttributes.restore) sdb.getAttributes.restore();
    if (sdb.putAttributes.restore) sdb.putAttributes.restore();
    if (sdb.deleteAttributes.restore) sdb.deleteAttributes.restore();
    if (sdb.select.restore) sdb.select.restore();
    if (recaptcha.verify.restore) recaptcha.verify.restore();
    if (sns.publish.restore) sns.publish.restore();
    if (ses.sendEmail.restore) ses.sendEmail.restore();
  });
});
