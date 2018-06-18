
/**
 * Copyright (c) 2017-present, Parsec Labs (parseclabs.org)
 *
 * This source code is licensed under the GNU Affero General Public License,
 * version 3, found in the LICENSE file in the root directory of this source 
 * tree.
 */

// curl -X POST https://api.mailerlite.com/api/v2/groups/1234567/subscribers
// -d '{"email":"test@mail.com" }'
// -H "Content-Type: application/json"
// -H "X-MailerLite-ApiKey: aabbccddeeff00112233445566778899"

function MailerLite(request, apiKey, group) {
  this.request = request;
  this.apiKey = apiKey;
  this.group = group;
}

MailerLite.prototype.add = function add(email) {
  // Set the headers
  const headers = {
    'Content-Type': 'application/json',
    'X-MailerLite-ApiKey': this.apiKey,
  };
  // Configure the request
  const options = {
    url: `https://api.mailerlite.com/api/v2/groups/${this.group}/subscribers`,
    method: 'POST',
    headers,
    body: JSON.stringify({ email }),
  };
  return new Promise((fulfill, reject) => {
    // Start the request
    this.request(options, (error, response, body) => {
      if (error || response.statusCode !== 200) {
        return reject({ error, status: response.statusCode });
      }
      return fulfill(body);
    });
  });
};

module.exports = MailerLite;
