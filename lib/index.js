// {
//     "Records": [
//         {
//             "eventID": "db2920985bc6ba7f5deef8d028876d5e",
//             "eventName": "MODIFY",
//             "eventVersion": "1.1",
//             "eventSource": "aws:dynamodb",
//             "awsRegion": "eu-west-1",
//             "dynamodb": {
//                 "ApproximateCreationDateTime": 1488198300,
//                 "Keys": {
//                     "handId": {
//                         "N": "4"
//                     },
//                     "tableAddr": {
//                         "S": "0xa2decf075b96c8e5858279b31f644501a140e8a7"
//                     }
//                 },
//                 "NewImage": {
//                     "deck": {},
//                     "dealer": "0",
//                     "handId": "4",
//                     "lineup": {
//                         "L": [
//                             {
//                                 "M": {
//                                     "address": {
//                                         "S": "0x82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f"
//                                     },
//                                     "last": {
//                                         "S": "eyJ0eXBlIjoiRVdUIiwiYWxnIjoiRVMyNTZrIn0.eyJiZXQiOlt7InVpbnQiOjR9LHsidWludCI6NTAwMDB9XSwidiI6MX0.aTQuKTw5m94EoDd6Ucn2qA7eRKdL1AtrjKErgZHOQXJtX6J7tRjWzhB14-sLcS0TpaK9ENT0LmN1c4Z9IlLWyg"
//                                     }
//                                 }
//                             },
//                             {
//                                 "M": {
//                                     "address": {
//                                         "S": "0xc3ccb3902a164b83663947aff0284c6624f3fbf2"
//                                     },
//                                     "last": {
//                                         "S": "eyJ0eXBlIjoiRVdUIiwiYWxnIjoiRVMyNTZrIn0.eyJiZXQiOlt7InVpbnQiOjR9LHsidWludCI6NTAwMDB9XSwidiI6MX0.aTQuKTw5m94EoDd6Ucn2qA7eRKdL1AtrjKErgZHOQXJtX6J7tRjWzhB14-sLcS0TpaK9ENT0LmN1c4Z9IlLWyg"
//                                     }
//                                 }
//                             },
//                             {
//                                 "M": {
//                                     "address": {
//                                         "S": "0xe10f3d125e5f4c753a6456fc37123cf17c6900f2"
//                                     }
//                                 }
//                             },
//                             {
//                                 "M": {
//                                     "address": {
//                                         "S": "0xf3beac30c498d9e26865f34fcaa57dbb935b0d74"
//                                     }
//                                 }
//                             }
//                         ]
//                     },
//                     "handState": {
//                         "S": "dealing"
//                     },
//                     "tableAddr": {
//                         "S": "0xa2decf075b96c8e5858279b31f644501a140e8a7"
//                     }
//                 },
//                 "OldImage": {
//                     "deck": {
//                     },
//                     "dealer": {
//                         "N": "0"
//                     },
//                     "handId": {
//                         "N": "4"
//                     },
//                     "lineup": {
//                         "L": [
//                             {
//                                 "M": {
//                                     "address": {
//                                         "S": "0x82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f"
//                                     }
//                                 }
//                             },
//                             {
//                                 "M": {
//                                     "address": {
//                                         "S": "0xc3ccb3902a164b83663947aff0284c6624f3fbf2"
//                                     },
//                                     "last": {
//                                         "S": "eyJ0eXBlIjoiRVdUIiwiYWxnIjoiRVMyNTZrIn0.eyJiZXQiOlt7InVpbnQiOjR9LHsidWludCI6NTAwMDB9XSwidiI6MX0.aTQuKTw5m94EoDd6Ucn2qA7eRKdL1AtrjKErgZHOQXJtX6J7tRjWzhB14-sLcS0TpaK9ENT0LmN1c4Z9IlLWyg"
//                                     }
//                                 }
//                             },
//                             {
//                                 "M": {
//                                     "address": {
//                                         "S": "0xe10f3d125e5f4c753a6456fc37123cf17c6900f2"
//                                     }
//                                 }
//                             },
//                             {
//                                 "M": {
//                                     "address": {
//                                         "S": "0xf3beac30c498d9e26865f34fcaa57dbb935b0d74"
//                                     }
//                                 }
//                             }
//                         ]
//                     },
//                     "handState": {
//                         "S": "dealing"
//                     },
//                     "tableAddr": {
//                         "S": "0xa2decf075b96c8e5858279b31f644501a140e8a7"
//                     }
//                 },
//                 "SequenceNumber": "742292900000000001062735493",
//                 "SizeBytes": 1558,
//                 "StreamViewType": "NEW_AND_OLD_IMAGES"
//             },
//             "eventSourceARN": "arn:aws:dynamodb:eu-west-1:105751009136:table/poker/stream/2017-02-27T12:13:35.529"
//         }
//     ]
// }

var StreamWorker = function(table) {
  this.table = table;
}

StreamWorker.prototype.process = function(record) {

  if (!record.eventName || record.eventName !== 'MODIFY') {
    return Promise.reject('unknown record type');
  }
  const newLu = record.dynamodb.NewImage.lineup.L;
  const oldLu = record.dynamodb.OldImage.lineup.L;
  const tableAddr = record.dynamodb.Keys.tableAddr.S;

  for (var i = 0; i < newLu.length; i++) {
    if (newLu[i].M.lastHand && !oldLu[i].M.lastHand) {
      // return after first leave detected
      // we don't expect more than one per db change
      return this.table.leave(tableAddr, newLu[i].M.leaveReceipt.S);
    }
  }
  // nothing to do
  return Promise.resolve({});
}

module.exports = StreamWorker;