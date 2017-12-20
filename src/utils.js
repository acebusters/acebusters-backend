import crypto from 'crypto';

export const delay = (ms, arg) => new Promise(resolve => setTimeout(resolve, ms, arg));

export const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';
export const isEmpty = seat => seat.address === EMPTY_ADDR;
export const hasReceipt = seat => !!seat.last;
export const not = fn => (...args) => !fn(...args);

export function now(secs = 0) {
  return Math.floor(Date.now() / 1000) + secs;
}

export const shuffle = function shuffle() {
  const array = [];
  for (let i = 0; i < 52; i += 1) {
    array.push(i);
  }
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = crypto.randomBytes(1)[0] % i;
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
  return array;
};

export function range(s, e) {
  return Array.from(new Array((e - s) + 1), (_, i) => i + s);
}

export function identity(a) {
  return a;
}

export function parseMessage(msg) {
  if (!msg.Subject || msg.Subject.split('::').length < 2) {
    throw new Error(`unknown message type: ${msg.Subject}`);
  }
  try {
    return {
      msgType: msg.Subject.split('::')[0],
      msgBody: (msg.Message && msg.Message.length > 0) ? JSON.parse(msg.Message) : '',
    };
  } catch (e) {
    throw new Error(`json parse error: ${JSON.stringify(e)}`);
  }
}

export function dbMethod(provider, name, params) {
  return new Promise((resolve, reject) => {
    provider[name](params, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

// transform from key/value to list and back
export function transform(data) {
  let attributes;
  if (Array.isArray(data)) {
    attributes = {};
    data.forEach((aPair) => {
      if (!attributes[aPair.Name]) {
        attributes[aPair.Name] = {};
      }
      attributes[aPair.Name] = aPair.Value;
    });
  } else {
    attributes = [];
    Object.keys(data).forEach((anAttributeName) => {
      data[anAttributeName].forEach((aValue) => {
        attributes.push({
          Name: anAttributeName,
          Value: aValue,
          Replace: true,
        });
      });
    });
  }
  return attributes;
}
